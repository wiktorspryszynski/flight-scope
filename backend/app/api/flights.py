import asyncio
import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text
from app.schemas.flight import Flight
from ..services.opensky import get_live_flights_raw
from ..services.heading import calculate_heading_from_previous_position
from ..services.cache import get_flights_cache
from ..db.repository import get_latest_snapshot_flights
from ..db.database import SessionLocal

router = APIRouter()

_DUMMY_FLIGHTS = [
    Flight(icao24="aaa001", callsign="DEV001", longitude=2.3522,  latitude=48.8566, altitude=10000, velocity=250, heading=45),
    Flight(icao24="aaa002", callsign="DEV002", longitude=13.4050, latitude=52.5200, altitude=8500,  velocity=220, heading=180),
    Flight(icao24="aaa003", callsign="DEV003", longitude=-0.1276, latitude=51.5074, altitude=11000, velocity=270, heading=270),
    Flight(icao24="aaa004", callsign="DEV004", longitude=12.4964, latitude=41.9028, altitude=9000,  velocity=240, heading=90),
    Flight(icao24="aaa005", callsign="DEV005", longitude=37.6173, latitude=55.7558, altitude=7500,  velocity=200, heading=315),
]

STATE_FIELDS = [
    "icao24", "callsign", "origin_country", "time_position", "last_contact",
    "longitude", "latitude", "baro_altitude", "on_ground", "velocity",
    "true_track", "vertical_rate", "sensors", "geo_altitude", "squawk",
    "spi", "position_source",
]

def _parse_state(raw: list) -> dict:
    return dict(zip(STATE_FIELDS, raw))

def build_live_flights_payload() -> list[Flight]:
    data = get_live_flights_raw()

    if not data or not data.get("states"):
        return []

    flights: list[Flight] = []

    for raw in data["states"]:
        state = _parse_state(raw)
        icao24 = state["icao24"]
        longitude = state["longitude"]
        latitude = state["latitude"]

        if not latitude or not longitude:
            continue

        computed_heading = calculate_heading_from_previous_position(
            icao24=icao24,
            latitude=latitude,
            longitude=longitude,
        )

        flights.append(
            Flight(
                icao24=icao24,
                callsign=state["callsign"],
                longitude=longitude,
                latitude=latitude,
                altitude=state["baro_altitude"],
                velocity=state["velocity"],
                heading=(
                    computed_heading
                    if computed_heading is not None
                    else state["true_track"]
                ),
            )
        )

    return flights

def get_flights_payload() -> list[Flight]:
    if os.getenv("DEV_DUMMY_DATA", "").lower() == "true":
        return _DUMMY_FLIGHTS
    return build_live_flights_payload()

class SnapshotResponse(BaseModel):
    snapshot_time: datetime
    is_downsampled: bool
    flights: list[Flight]


def _flights_at(t: float) -> SnapshotResponse:
    with SessionLocal() as session:
        # Use two bounded index-range queries (one on each side of :t) then pick
        # the closer one, rather than a full table scan with ORDER BY ABS(...).
        snap = session.execute(
            text("""
                SELECT id, snapshot_time FROM (
                    (SELECT id, snapshot_time FROM flight_snapshots
                     WHERE snapshot_time <= to_timestamp(:t)
                     ORDER BY snapshot_time DESC LIMIT 1)
                    UNION ALL
                    (SELECT id, snapshot_time FROM flight_snapshots
                     WHERE snapshot_time  > to_timestamp(:t)
                     ORDER BY snapshot_time ASC  LIMIT 1)
                ) candidates
                ORDER BY ABS(EXTRACT(EPOCH FROM snapshot_time) - :t)
                LIMIT 1
            """),
            {"t": t},
        ).mappings().fetchone()

        if snap is None:
            return SnapshotResponse(
                snapshot_time=datetime.fromtimestamp(t, tz=timezone.utc),
                is_downsampled=False,
                flights=[],
            )

        positions = session.execute(
            text("""
                SELECT icao24, callsign, latitude, longitude, heading, altitude, velocity
                FROM flight_positions
                WHERE snapshot_id = :sid
            """),
            {"sid": snap["id"]},
        ).mappings().fetchall()

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        is_downsampled = snap["snapshot_time"].replace(tzinfo=timezone.utc) < cutoff

        return SnapshotResponse(
            snapshot_time=snap["snapshot_time"],
            is_downsampled=is_downsampled,
            flights=[Flight(**p) for p in positions],
        )


@router.get("/at", response_model=SnapshotResponse)
async def flights_at(t: float = Query(..., description="Unix timestamp")):
    return await asyncio.to_thread(_flights_at, t)


@router.get("/live", response_model=list[Flight])
async def live_flights():
    cached = await asyncio.to_thread(get_flights_cache)
    if cached is not None:
        return [Flight(**f) for f in cached]

    try:
        flights = await asyncio.to_thread(get_flights_payload)
        if flights:
            return flights
    except Exception:
        pass

    db_flights = await asyncio.to_thread(get_latest_snapshot_flights)
    return [Flight(**f) for f in db_flights]

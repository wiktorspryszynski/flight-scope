import asyncio
import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text
import requests

from ..db.database import SessionLocal
from ..services.opensky import get_auth_headers
from ..services.heading import get_redis_client

router = APIRouter()

_OPENSKY_METADATA_URL = "https://opensky-network.org/api/metadata/aircraft/icao"
_META_CACHE_TTL = 3600  # aircraft metadata rarely changes


class AircraftInfo(BaseModel):
    icao24: str
    registration: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    typecode: Optional[str] = None
    operator: Optional[str] = None
    owner: Optional[str] = None
    built: Optional[int] = None
    engines: Optional[str] = None


class HistoryPoint(BaseModel):
    latitude: float
    longitude: float
    heading: Optional[float] = None
    altitude: Optional[float] = None
    velocity: Optional[float] = None
    snapshot_time: datetime


def _fetch_aircraft_info(icao24: str) -> AircraftInfo:
    redis = get_redis_client()
    cache_key = f"aircraft:meta:{icao24}"
    cached = redis.get(cache_key)
    if cached:
        return AircraftInfo(**json.loads(cached))

    try:
        r = requests.get(
            f"{_OPENSKY_METADATA_URL}/{icao24}",
            headers=get_auth_headers(),
            timeout=8,
        )
        if r.status_code == 404:
            info = AircraftInfo(icao24=icao24)
        else:
            r.raise_for_status()
            d = r.json()
            info = AircraftInfo(
                icao24=icao24,
                registration=d.get("registration") or None,
                manufacturer=d.get("manufacturerName") or None,
                model=d.get("model") or None,
                typecode=d.get("typecode") or None,
                operator=d.get("operatorCallsign") or d.get("operator") or None,
                owner=d.get("owner") or None,
                built=d.get("built") or None,
                engines=d.get("engines") or None,
            )
    except Exception:
        info = AircraftInfo(icao24=icao24)

    redis.setex(cache_key, _META_CACHE_TTL, json.dumps(info.model_dump()))
    return info


def _fetch_history(icao24: str, hours: int) -> list[HistoryPoint]:
    with SessionLocal() as session:
        rows = session.execute(
            text("""
                SELECT latitude, longitude, heading, altitude, velocity, snapshot_time
                FROM flight_positions
                WHERE icao24 = :icao24
                  AND snapshot_time > NOW() - (:hours * INTERVAL '1 hour')
                ORDER BY snapshot_time ASC
            """),
            {"icao24": icao24, "hours": hours},
        ).mappings().all()
        return [HistoryPoint(**r) for r in rows]


@router.get("/{icao24}/info", response_model=AircraftInfo)
async def get_aircraft_info(icao24: str):
    return await asyncio.to_thread(_fetch_aircraft_info, icao24.lower())


@router.get("/{icao24}/history", response_model=list[HistoryPoint])
async def get_aircraft_history(icao24: str, hours: int = Query(default=6, ge=1, le=24)):
    return await asyncio.to_thread(_fetch_history, icao24.lower(), hours)

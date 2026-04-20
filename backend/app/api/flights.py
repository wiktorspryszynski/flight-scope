from fastapi import APIRouter, HTTPException
from app.schemas.flight import Flight
from ..services.opensky import get_live_flights_raw
from ..services.heading import calculate_heading_from_previous_position

router = APIRouter()

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

@router.get("/live", response_model=list[Flight])
def live_flights():
    return build_live_flights_payload()

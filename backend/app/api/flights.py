from fastapi import APIRouter
from app.schemas.flight import Flight
from ..services.opensky import get_live_flights_raw
from ..services.heading import calculate_heading_from_previous_position

router = APIRouter()

def build_live_flights_payload() -> list[Flight]:
    data = get_live_flights_raw()

    if not data or not data.get("states"):
        return []

    flights: list[Flight] = []

    for state in data["states"]:
        icao24     = state[0]
        longitude  = state[5]
        latitude   = state[6]
        computed_heading = calculate_heading_from_previous_position(
            icao24=icao24,
            latitude=latitude,
            longitude=longitude,
        )

        flights.append(
            Flight(
                icao24=icao24,
                callsign=state[1],
                longitude=longitude,
                latitude=latitude,
                altitude=state[7],
                velocity=state[9],
                heading=(
                    computed_heading
                    if computed_heading is not None
                    else state[10]
                ),
            )
        )

    return flights

@router.get("/live", response_model=list[Flight])
def live_flights():
    return build_live_flights_payload()

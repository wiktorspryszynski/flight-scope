from fastapi import APIRouter, HTTPException
from app.schemas.flight import Flight
from ..services.opensky import get_live_flights_raw
from ..services.heading import calculate_heading_from_previous_position

router = APIRouter()

def build_live_flights_payload() -> list[Flight]:
    states = get_live_flights_raw()

    if states is None:
        raise HTTPException(status_code=503, detail="OpenSky API unavailable or credentials invalid")

    if states.states is None:
        return []

    flights: list[Flight] = []

    for state in states.states:
        icao24 = getattr(state, "icao24", None)
        longitude = getattr(state, "longitude", getattr(state, "lon", None))
        latitude = getattr(state, "latitude", getattr(state, "lat", None))
        computed_heading = calculate_heading_from_previous_position(
            icao24=icao24,
            latitude=latitude,
            longitude=longitude,
        )

        flights.append(
            Flight(
                icao24=icao24,
                callsign=getattr(state, "callsign", None),
                longitude=longitude,
                latitude=latitude,
                altitude=getattr(state, "baro_altitude", None),
                velocity=getattr(state, "velocity", None),
                heading=(
                    computed_heading
                    if computed_heading is not None
                    else getattr(state, "true_track", None)
                ),
            )
        )

    return flights

@router.get("/live", response_model=list[Flight])
def live_flights():
    return build_live_flights_payload()

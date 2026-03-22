from fastapi import APIRouter, Query
from app.schemas.flight import Flight
from ..services.opensky import get_live_flights_raw

router = APIRouter()

def build_live_flights_payload(max_flights: int = 100) -> list[Flight]:
    states = get_live_flights_raw()

    if states is None or states.states is None:
        return []

    flights: list[Flight] = []

    for state in states.states:
        flights.append(
            Flight(
                icao24=getattr(state, "icao24", None),
                callsign=getattr(state, "callsign", None),
                longitude=getattr(state, "longitude", getattr(state, "lon", None)),
                latitude=getattr(state, "latitude", getattr(state, "lat", None)),
                altitude=getattr(state, "baro_altitude", None),
                velocity=getattr(state, "velocity", None),
                heading=getattr(state, "true_track", None),
            )
        )

    return flights[:max_flights]

@router.get("/live", response_model=list[Flight])
def live_flights(
    max_flights: int = Query(default=100, ge=1, alias="maxFlights"),
):
    return build_live_flights_payload(max_flights=max_flights)
from datetime import datetime, timezone
from .database import SessionLocal
from ..models.flight_snapshot import FlightSnapshot


def save_snapshot(flights_data: list[dict]) -> None:
    with SessionLocal() as session:
        row = FlightSnapshot(
            snapshot_time=datetime.now(timezone.utc),
            flights=flights_data,
        )
        session.add(row)
        session.commit()

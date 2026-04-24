from datetime import datetime, timezone
from sqlalchemy import insert, text
from .database import SessionLocal
from ..models.flight_snapshot import FlightPosition, FlightSnapshot


def save_snapshot(flights_data: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        snapshot = FlightSnapshot(snapshot_time=now)
        session.add(snapshot)
        session.flush()  # populate snapshot.id
        session.execute(
            insert(FlightPosition),
            [
                {
                    "snapshot_id": snapshot.id,
                    "snapshot_time": now,
                    "icao24": f["icao24"],
                    "callsign": f.get("callsign"),
                    "latitude": f["latitude"],
                    "longitude": f["longitude"],
                    "heading": f.get("heading"),
                    "altitude": f.get("altitude"),
                    "velocity": f.get("velocity"),
                }
                for f in flights_data
            ],
        )
        session.commit()


def downsample_old_snapshots() -> None:
    with SessionLocal() as session:
        session.execute(
            text("""
                DELETE FROM flight_snapshots
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY date_trunc('5 minutes', snapshot_time)
                                   ORDER BY snapshot_time
                               ) AS rn
                        FROM flight_snapshots
                        WHERE snapshot_time < now() - interval '24 hours'
                    ) ranked
                    WHERE rn > 1
                )
            """)
        )
        session.commit()

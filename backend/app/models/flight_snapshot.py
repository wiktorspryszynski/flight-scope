from datetime import datetime, timezone
from sqlalchemy import DateTime, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from ..db.database import Base


class FlightSnapshot(Base):
    __tablename__ = "flight_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        default=lambda: datetime.now(timezone.utc),
    )
    flights: Mapped[dict] = mapped_column(JSONB, nullable=False)

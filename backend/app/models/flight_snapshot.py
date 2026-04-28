from datetime import datetime, timezone
from sqlalchemy import BigInteger, DateTime, Double, Float, ForeignKey, Integer, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..db.database import Base


class FlightSnapshot(Base):
    __tablename__ = "flight_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    positions: Mapped[list["FlightPosition"]] = relationship(
        "FlightPosition", back_populates="snapshot", cascade="all, delete-orphan"
    )


class FlightPosition(Base):
    __tablename__ = "flight_positions"
    __table_args__ = (
        Index("ix_flight_positions_icao24_time", "icao24", "snapshot_time"),
        Index("ix_flight_positions_snapshot_time", "snapshot_time"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("flight_snapshots.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    icao24: Mapped[str] = mapped_column(Text, nullable=False)
    callsign: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    velocity: Mapped[float | None] = mapped_column(Float, nullable=True)

    snapshot: Mapped["FlightSnapshot"] = relationship("FlightSnapshot", back_populates="positions")

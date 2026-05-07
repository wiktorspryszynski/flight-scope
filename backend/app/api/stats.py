import asyncio
from datetime import datetime
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from ..db.database import SessionLocal

router = APIRouter()


class DBStats(BaseModel):
    snapshot_count: int
    position_count: int
    db_size_bytes: int
    db_size_pretty: str
    positions_table_size_pretty: str
    oldest_snapshot: Optional[datetime]
    newest_snapshot: Optional[datetime]
    snapshots_last_24h: int


def _query_stats() -> DBStats:
    with SessionLocal() as session:
        row = session.execute(text("""
            SELECT
                (SELECT COUNT(*) FROM flight_snapshots)::int                           AS snapshot_count,
                (SELECT COUNT(*) FROM flight_positions)::int                           AS position_count,
                pg_database_size(current_database())                                   AS db_size_bytes,
                pg_size_pretty(pg_database_size(current_database()))                   AS db_size_pretty,
                pg_size_pretty(pg_relation_size('flight_positions'))                   AS positions_table_size_pretty,
                (SELECT MIN(snapshot_time) FROM flight_snapshots)                      AS oldest_snapshot,
                (SELECT MAX(snapshot_time) FROM flight_snapshots)                      AS newest_snapshot,
                (SELECT COUNT(*) FROM flight_snapshots
                 WHERE snapshot_time > NOW() - INTERVAL '24 hours')::int               AS snapshots_last_24h
        """)).mappings().one()
        return DBStats(**row)


@router.get("/stats", response_model=DBStats)
async def get_stats():
    return await asyncio.to_thread(_query_stats)

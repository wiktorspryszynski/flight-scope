import asyncio
import logging

from ..api.flights import get_flights_payload
from ..services.broadcast import ConnectionManager
from ..services.cache import set_flights_cache
from ..db.repository import save_snapshot

logger = logging.getLogger(__name__)

FETCH_INTERVAL = 15


async def flight_fetcher_loop(manager: ConnectionManager) -> None:
    while True:
        try:
            flights = await asyncio.to_thread(get_flights_payload)
            flights_data = [f.model_dump() for f in flights]

            await asyncio.to_thread(set_flights_cache, flights_data)
            await asyncio.to_thread(save_snapshot, flights_data)
            await manager.broadcast(flights_data)
        except Exception:
            logger.exception("flight_fetcher_loop error")

        await asyncio.sleep(FETCH_INTERVAL)

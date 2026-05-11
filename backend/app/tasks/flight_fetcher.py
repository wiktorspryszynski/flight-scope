import asyncio
import logging

from ..api.flights import get_flights_payload
from ..services.broadcast import ConnectionManager
from ..services.cache import get_flights_cache, set_flights_cache
from ..db.repository import downsample_old_snapshots, get_latest_snapshot_flights, save_snapshot

logger = logging.getLogger(__name__)

FETCH_INTERVAL = 60
DOWNSAMPLE_EVERY_N_CYCLES = 60  # once per hour


async def flight_fetcher_loop(manager: ConnectionManager) -> None:
    cycle = 0
    while True:
        try:
            prev_data = await asyncio.to_thread(get_flights_cache)
            flights = await asyncio.to_thread(get_flights_payload)
            flights_data = [f.model_dump() for f in flights]

            if not flights_data:
                db_fallback = await asyncio.to_thread(get_latest_snapshot_flights)
                if db_fallback:
                    logger.warning("OpenSky returned no data; serving last DB snapshot (%d flights)", len(db_fallback))
                    await asyncio.to_thread(set_flights_cache, db_fallback)
                    broadcast_prev = prev_data if prev_data is not None else db_fallback
                    await manager.broadcast({"prev": broadcast_prev, "next": db_fallback, "stale": True})
                else:
                    logger.warning("OpenSky returned no data and DB has no snapshot; skipping broadcast")
                await asyncio.sleep(FETCH_INTERVAL)
                continue

            await asyncio.to_thread(set_flights_cache, flights_data)
            await asyncio.to_thread(save_snapshot, flights_data)

            broadcast_prev = prev_data if prev_data is not None else flights_data
            await manager.broadcast({"prev": broadcast_prev, "next": flights_data})

            cycle += 1
            if cycle % DOWNSAMPLE_EVERY_N_CYCLES == 0:
                await asyncio.to_thread(downsample_old_snapshots)
                logger.info("Downsampled old flight snapshots")
        except RuntimeError as e:
            if "rate limit" in str(e).lower():
                logger.warning("OpenSky rate limit hit, backing off 5 minutes")
                await asyncio.sleep(300)
                continue
            logger.exception("flight_fetcher_loop error")
        except Exception:
            logger.exception("flight_fetcher_loop error")

        await asyncio.sleep(FETCH_INTERVAL)

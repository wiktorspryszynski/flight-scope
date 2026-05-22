import asyncio
import logging
import os

from ..api.flights import get_flights_payload
from ..services.broadcast import ConnectionManager
from ..services.cache import get_flights_cache, set_flights_cache
from ..services import rate_limit_tracker
from ..services.opensky import RateLimitError, OpenSkyTimeoutError, OpenSkyConnectionError
from ..db.repository import downsample_old_snapshots, get_latest_snapshot_flights, save_snapshot

logger = logging.getLogger(__name__)

# FLIGHT_FETCH_INTERVAL_SECONDS is the canonical backend name.
# VITE_FLIGHT_FETCH_INTERVAL_SECONDS is the Vite build-time prefix used by the
# frontend; it is kept as a fallback so existing .env files that only set the
# VITE_* key continue to work.  When setting up a new deployment, prefer
# setting both to the same value rather than relying on the VITE_* one here.
FETCH_INTERVAL = int(
    os.getenv("FLIGHT_FETCH_INTERVAL_SECONDS")
    or os.getenv("VITE_FLIGHT_FETCH_INTERVAL_SECONDS")
    or "120"
)
DOWNSAMPLE_EVERY_N_CYCLES = 3600 // FETCH_INTERVAL  # once per hour


async def _broadcast_stale_or_empty(manager: ConnectionManager, prev_data: list | None) -> None:
    db_fallback = await asyncio.to_thread(get_latest_snapshot_flights)
    if db_fallback:
        logger.warning("Serving last DB snapshot (%d flights) as stale data", len(db_fallback))
        await asyncio.to_thread(set_flights_cache, db_fallback)
        broadcast_prev = prev_data if prev_data is not None else db_fallback
        await manager.broadcast({"prev": broadcast_prev, "next": db_fallback, "stale": True})
    else:
        logger.warning("No DB snapshot available; broadcasting empty")
        await manager.broadcast({"prev": [], "next": [], "noData": True})


async def flight_fetcher_loop(manager: ConnectionManager) -> None:
    cycle = 0
    while True:
        prev_data = None
        try:
            prev_data = await asyncio.to_thread(get_flights_cache)
            flights = await asyncio.to_thread(get_flights_payload)
            flights_data = [f.model_dump() for f in flights]

            if not flights_data:
                logger.warning("OpenSky returned no data; falling back to DB snapshot")
                await _broadcast_stale_or_empty(manager, prev_data)
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
        except RateLimitError as e:
            rate_limit_tracker.record_hit()
            logger.warning("OpenSky rate limit hit, backing off 5 minutes: %s", e)
            await _broadcast_stale_or_empty(manager, prev_data)
            await asyncio.sleep(300)
            continue
        except (OpenSkyTimeoutError, OpenSkyConnectionError) as e:
            logger.warning("OpenSky connectivity issue (%s), backing off 5 minutes", e)
            await _broadcast_stale_or_empty(manager, prev_data)
            await asyncio.sleep(300)
            continue
        except Exception:
            logger.exception("flight_fetcher_loop error")

        await asyncio.sleep(FETCH_INTERVAL)

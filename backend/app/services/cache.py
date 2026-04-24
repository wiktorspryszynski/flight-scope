import json
from typing import Optional, cast
from .heading import get_redis_client

LATEST_KEY = "flights:latest"
PREV_KEY = "flights:prev"
LATEST_TTL = 130
PREV_TTL = 130


def set_flights_cache(flights_data: list[dict]) -> None:
    r = get_redis_client()
    # Rotate: latest → prev, then store new latest
    current = cast(Optional[str], r.get(LATEST_KEY))
    if current:
        r.setex(PREV_KEY, PREV_TTL, current)
    r.setex(LATEST_KEY, LATEST_TTL, json.dumps(flights_data))


def get_flights_cache() -> list[dict] | None:
    raw = cast(Optional[str], get_redis_client().get(LATEST_KEY))
    return json.loads(raw) if raw else None


def get_flights_prev_cache() -> list[dict] | None:
    raw = cast(Optional[str], get_redis_client().get(PREV_KEY))
    return json.loads(raw) if raw else None

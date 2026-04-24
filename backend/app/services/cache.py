import json
from typing import Optional, cast
from .heading import get_redis_client

CACHE_KEY = "flights:latest"
CACHE_TTL = 30


def set_flights_cache(flights_data: list[dict]) -> None:
    get_redis_client().setex(CACHE_KEY, CACHE_TTL, json.dumps(flights_data))


def get_flights_cache() -> list[dict] | None:
    raw = cast(Optional[str], get_redis_client().get(CACHE_KEY))
    return json.loads(raw) if raw else None

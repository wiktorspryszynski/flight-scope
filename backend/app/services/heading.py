import json
import math
import os
from functools import lru_cache
from typing import Optional, cast

from redis import Redis
from redis.exceptions import RedisError


REDIS_KEY_PREFIX = "flights:last_position"
REDIS_TTL_SECONDS = int(os.getenv("FLIGHT_POSITION_TTL_SECONDS", "300"))
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))


@lru_cache(maxsize=1)
def get_redis_client() -> Redis:
    return Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        db=REDIS_DB,
        decode_responses=True,
    )


def _bearing_degrees(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
) -> Optional[float]:
    if from_lat == to_lat and from_lon == to_lon:
        return None

    lat1 = math.radians(from_lat)
    lat2 = math.radians(to_lat)
    delta_lon = math.radians(to_lon - from_lon)

    y = math.sin(delta_lon) * math.cos(lat2)
    x = (math.cos(lat1) * math.sin(lat2)) - (
        math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    )

    if x == 0 and y == 0:
        return None

    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360.0) % 360.0


def _position_key(icao24: str) -> str:
    return f"{REDIS_KEY_PREFIX}:{icao24}"


def _decode_position(raw: Optional[str]) -> Optional[tuple[float, float]]:
    if not raw:
        return None

    try:
        payload = json.loads(raw)
        lat = float(payload["lat"])
        lon = float(payload["lon"])
        return lat, lon
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def calculate_heading_from_previous_position(
    icao24: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
) -> Optional[float]:
    if not icao24 or latitude is None or longitude is None:
        return None

    try:
        client = get_redis_client()
        previous_raw = cast(Optional[str], client.get(_position_key(icao24)))
        previous_position = _decode_position(previous_raw)
        client.setex(
            _position_key(icao24),
            REDIS_TTL_SECONDS,
            json.dumps({"lat": latitude, "lon": longitude}),
        )
    except RedisError:
        return None

    if previous_position is None:
        return None

    previous_lat, previous_lon = previous_position
    return _bearing_degrees(previous_lat, previous_lon, latitude, longitude)

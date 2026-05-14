from collections import deque
from datetime import datetime, timezone, timedelta

_hits: deque[datetime] = deque()


def record_hit() -> None:
    _hits.append(datetime.now(timezone.utc))


def hits_in_last(hours: int = 24) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    while _hits and _hits[0] < cutoff:
        _hits.popleft()
    return len(_hits)

from collections import deque
from datetime import datetime, timezone, timedelta

# NOTE: This is a simple in-process tracker. It has two known limitations:
#   1. History is lost on every backend restart — the 24-hour counter starts
#      from zero each time the process comes up.
#   2. It does not aggregate across multiple workers. If uvicorn is run with
#      --workers > 1, each worker maintains its own independent deque, so the
#      reported count will be a fraction of reality.
# For a single-worker deployment these are cosmetic issues only.
# To fix properly, persist hits in Redis (e.g. a sorted set keyed on timestamp)
# alongside the other flight data so counts survive restarts and are shared
# across all workers.
_hits: deque[datetime] = deque()


def record_hit() -> None:
    _hits.append(datetime.now(timezone.utc))


def hits_in_last(hours: int = 24) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    while _hits and _hits[0] < cutoff:
        _hits.popleft()
    return len(_hits)

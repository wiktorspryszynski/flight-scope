import asyncio


class ConnectionManager:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()

    def connect(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2)
        self._queues.add(q)
        return q

    def disconnect(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    async def broadcast(self, payload: dict | list[dict]) -> None:
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass


manager = ConnectionManager()

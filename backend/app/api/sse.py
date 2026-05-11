import asyncio
import json
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..services.broadcast import manager
from ..services.cache import get_flights_cache, get_flights_prev_cache

router = APIRouter()

_KEEPALIVE_INTERVAL = 30  # seconds between keepalive comments when no flight update arrives


@router.get("/sse/flights")
async def sse_flights(request: Request):
    async def event_stream():
        q = manager.connect()
        try:
            latest = await asyncio.to_thread(get_flights_cache)
            if latest is not None:
                prev = await asyncio.to_thread(get_flights_prev_cache)
                payload = {"prev": prev if prev is not None else latest, "next": latest}
                yield f"data: {json.dumps(payload)}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=_KEEPALIVE_INTERVAL)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            manager.disconnect(q)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

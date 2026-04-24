import asyncio
import os
from contextlib import asynccontextmanager, suppress
from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI, WebSocket
from fastapi import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(find_dotenv())
from .api.flights import router as flights_router
from .db.database import engine, Base
from .models import flight_snapshot as _  # noqa: F401 — registers FlightSnapshot with Base metadata
from .services.broadcast import manager
from .tasks.flight_fetcher import flight_fetcher_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(Base.metadata.create_all, engine)
    task = asyncio.create_task(flight_fetcher_loop(manager))
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(lifespan=lifespan)

_frontend_port = os.getenv("FRONTEND_PORT", "5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://spryszynski.pl",
        "https://www.spryszynski.pl",
        "https://flights.spryszynski.pl",
        f"http://localhost:{_frontend_port}",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(flights_router, prefix="/api/flights")


@app.websocket("/api/ws/flights")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    q = manager.connect()
    try:
        while True:
            payload = await q.get()
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(q)

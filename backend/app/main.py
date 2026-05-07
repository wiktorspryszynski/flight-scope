import asyncio
import os
from contextlib import asynccontextmanager, suppress
from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(find_dotenv())
from .api.flights import router as flights_router
from .api.stats import router as stats_router
from .api.aircraft import router as aircraft_router
from .api.sse import router as sse_router
from .db.database import engine, Base
from .models import flight_snapshot as _  # noqa: F401 — registers ORM models with Base metadata
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
app.include_router(aircraft_router, prefix="/api/flights")
app.include_router(stats_router, prefix="/api")
app.include_router(sse_router, prefix="/api")

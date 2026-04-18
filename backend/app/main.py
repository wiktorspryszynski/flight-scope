import asyncio
from dotenv import load_dotenv, find_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket
from fastapi import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(find_dotenv())
from .api.flights import router as flights_router
from .api.flights import build_live_flights_payload

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://spryszynski.pl",
        "https://www.spryszynski.pl",
        "https://flights.spryszynski.pl",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(flights_router, prefix="/api/flights")

@app.websocket("/api/ws/flights")
async def websocket_endpoint(
    websocket: WebSocket,
    interval_ms: int = Query(default=10_000, ge=100),
):
    await websocket.accept()
    interval_sec = interval_ms / 1000
    try:
        while True:
            try:
                payload = build_live_flights_payload()
            except HTTPException:
                payload = []
            await websocket.send_json([flight.model_dump() for flight in payload])
            await asyncio.sleep(interval_sec)
    except WebSocketDisconnect:
        return
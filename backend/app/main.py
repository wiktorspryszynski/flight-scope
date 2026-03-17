import asyncio
from fastapi import FastAPI, WebSocket
from fastapi import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from .api.flights import router as flights_router
from .api.flights import build_live_flights_payload

app = FastAPI()
app.include_router(flights_router, prefix="/flights")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/flights")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            payload = build_live_flights_payload()
            await websocket.send_json([flight.model_dump() for flight in payload])
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        return
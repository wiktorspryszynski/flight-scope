import os
from urllib.parse import urlparse

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .api.flights import router as flights_router
from .services.opensky_service import get_live_flights

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
    while True:
        data = get_live_flights()
        await websocket.send_json(data)
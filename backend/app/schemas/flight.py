from pydantic import BaseModel
from typing import Optional

class Flight(BaseModel):
    icao24: Optional[str]
    callsign: Optional[str]
    longitude: Optional[float]
    latitude: Optional[float]
    altitude: Optional[float]
    velocity: Optional[float]
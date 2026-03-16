from fastapi import APIRouter
from ..services.opensky_service import get_live_flights

router = APIRouter()

@router.get("/live")
def live_flights():
    return get_live_flights()
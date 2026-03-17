from opensky_api import OpenSkyApi
import os
from dotenv import load_dotenv

load_dotenv()

api = OpenSkyApi(
    os.getenv("OPENSKY_LOGIN"),
    os.getenv("OPENSKY_PASSWORD")
)

def get_live_flights_raw():
    states = api.get_states()
    return states
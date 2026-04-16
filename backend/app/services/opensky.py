from opensky_api import OpenSkyApi
import os

def get_live_flights_raw():
    api = OpenSkyApi(
        os.getenv("OPENSKY_LOGIN"),
        os.getenv("OPENSKY_PASSWORD"),
    )
    return api.get_states()
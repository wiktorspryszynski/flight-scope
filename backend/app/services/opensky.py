import requests
import os

OPENSKY_URL = "https://opensky-network.org/api/states/all"

def get_live_flights_raw():
    login = os.getenv("OPENSKY_LOGIN")
    password = os.getenv("OPENSKY_PASSWORD")
    
    auth = (login, password) if login and password else None
    
    response = requests.get(OPENSKY_URL, auth=auth, timeout=10)
    response.raise_for_status()
    return response.json()
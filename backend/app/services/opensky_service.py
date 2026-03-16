import requests

def get_live_flights():
    url = "https://opensky-network.org/api/states/all"
    r = requests.get(url)
    return r.json()
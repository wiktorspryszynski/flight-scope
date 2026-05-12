import os
import threading
import requests
from datetime import datetime, timedelta
from requests.exceptions import ConnectTimeout, ConnectionError as RequestsConnectionError

OPENSKY_URL = "https://opensky-network.org/api/states/all"
_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)
_TOKEN_REFRESH_MARGIN = 30


class TokenManager:
    def __init__(self, client_id: str, client_secret: str):
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self._expires_at: datetime | None = None
        self._lock = threading.Lock()

    def get_token(self) -> str:
        with self._lock:
            if self._token and self._expires_at and datetime.now() < self._expires_at:
                return self._token
            return self._refresh()

    def _refresh(self) -> str:
        r = requests.post(
            _TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        self._token = data["access_token"]
        expires_in = data.get("expires_in", 1800)
        self._expires_at = datetime.now() + timedelta(
            seconds=expires_in - _TOKEN_REFRESH_MARGIN
        )
        assert self._token is not None
        return self._token

    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.get_token()}"}


def get_auth_headers() -> dict:
    """Return Bearer auth headers if credentials are configured, else empty dict."""
    global _token_manager
    if not (os.getenv("OPENSKY_CLIENT_ID") and os.getenv("OPENSKY_CLIENT_SECRET")):
        return {}
    if _token_manager is None:
        _token_manager = _build_token_manager()
    return _token_manager.headers() if _token_manager else {}


def _build_token_manager() -> TokenManager | None:
    client_id = os.getenv("OPENSKY_CLIENT_ID")
    client_secret = os.getenv("OPENSKY_CLIENT_SECRET")
    if client_id and client_secret:
        return TokenManager(client_id, client_secret)
    import warnings
    warnings.warn(
        "OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET not set — "
        "using anonymous access (stricter rate limits)"
    )
    return None


_token_manager: TokenManager | None = None


def get_live_flights_raw() -> dict:
    global _token_manager

    try:
        if os.getenv("OPENSKY_CLIENT_ID") and os.getenv("OPENSKY_CLIENT_SECRET"):
            if _token_manager is None:
                _token_manager = _build_token_manager()
            response = requests.get(
                OPENSKY_URL,
                headers=_token_manager.headers() if _token_manager else None,
                timeout=10,
            )
        else:
            response = requests.get(OPENSKY_URL, timeout=10)
    except ConnectTimeout:
        raise RuntimeError("OpenSky connection timeout")
    except RequestsConnectionError:
        raise RuntimeError("OpenSky connection error")

    if response.status_code == 429:
        raise RuntimeError("OpenSky rate limit exceeded, try again shortly")
    response.raise_for_status()
    return response.json()

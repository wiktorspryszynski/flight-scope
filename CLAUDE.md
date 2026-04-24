# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (`frontend/`)

```bash
npm run dev        # start dev server (localhost:5173)
npm run build      # tsc type-check + vite build
npm run lint       # eslint
npm run preview    # preview production build
```

### Backend (`backend/`)

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend has no test suite currently; linting is not configured.

### Full stack (Docker)

```bash
docker compose up --build   # starts backend, frontend, postgres, redis
```

Requires a `.env` file in the project root with:
- `OPENSKY_LOGIN`, `OPENSKY_PASSWORD` — OpenSky Network credentials
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB` — Redis connection (defaults: `redis`, `6379`, `0`)
- `FLIGHT_POSITION_TTL_SECONDS` — per-aircraft heading cache TTL (default: `300`)
- `VITE_API_BASE_URL` — frontend env var pointing to backend (e.g. `http://localhost:8000`)
- `VITE_MAPTILER_KEY` — MapTiler API key for the map style
- `DEV_DUMMY_DATA` — set to `"true"` to use static dummy flights instead of OpenSky

## Architecture

This is a real-time flight tracker with a Python/FastAPI backend and a React/TypeScript frontend.

### Data flow

1. **Background job** (`backend/app/tasks/flight_fetcher.py`) runs every 60 seconds:
   - Fetches live aircraft state vectors from the OpenSky Network API (`backend/app/services/opensky.py`)
   - Rotates Redis cache: current `flights:latest` → `flights:prev`, then writes new data to `flights:latest` (TTL: 130 s)
   - Saves a full snapshot to PostgreSQL (`FlightSnapshot` + `FlightPosition` rows)
   - Broadcasts `{"prev": [...], "next": [...]}` to all connected WebSocket clients
   - Every hour: downsamples PostgreSQL data older than 24 h to one snapshot per 5-minute window
2. **Heading** is computed from per-aircraft position stored in Redis (`flights:last_position:{icao24}`, TTL: 300 s). Falls back to OpenSky `true_track` if no prior position exists (`backend/app/services/heading.py`).
3. **`GET /api/flights/live`** reads from `flights:latest` in Redis; falls back to a live OpenSky call if the cache has expired.
4. **`WS /api/ws/flights`** sends the initial `{prev, next}` state from Redis on connect, then streams each subsequent broadcast from the fetcher loop.

### Frontend rendering strategy

`FlightsMap.tsx` is the core rendering component and implements a dual-mode rendering strategy:

- **Globe mode** (zoom < 5): Uses `react-map-gl` `<Marker>` elements rendered as DOM nodes (HTML `<img>` buttons). A spatial grid-based sampling algorithm (`selectEvenlyDistributedFlights`) limits rendered flights to ~520 max to keep performance acceptable on a globe projection.
- **Mercator mode** (zoom ≥ 5): Switches to a `deck.gl` `IconLayer` rendered via `DeckGLOverlay` (a thin `useControl` wrapper). This handles up to 800 flights with GPU-accelerated rendering.

The map tile style comes from MapTiler. Projection is switched by calling `map.setProjection()` imperatively on the MapLibre map instance.

### Key rendering constants (`FlightsMap.tsx`)

| Constant | Purpose |
|---|---|
| `MERCATOR_ZOOM_THRESHOLD` (5) | Zoom level that triggers globe ↔ mercator switch |
| `GLOBE_VISIBILITY_DOT_THRESHOLD` (0.55) | Dot product cutoff for back-face culling on globe |
| `MAX_MERCATOR_RENDERED_FLIGHTS` (800) | Hard cap for deck.gl icon layer |
| `MAX_GLOBE_RENDERED_FLIGHTS` (520) | Hard cap for DOM markers on globe |

### Component structure

```
App.tsx               — fetches flights once from REST, passes to FlightsMap
modules/
  FlightsMap.tsx           — map, projection switching, flight rendering, hover/select state
  FlightInfoCard.tsx       — sidebar card shown when a flight is clicked
  PlaneScenegraphLayer.tsx — deck.gl ScenegraphLayer that renders a GLTF 3D airplane model
                             (assets/models/airbus_a319.glb) for the selected flight via rAF loop
  LoadingStatus.tsx        — overlay shown while loading
  ErrorStatus.tsx          — full-page error display
  Credits.tsx              — attribution overlay
types/flight.ts            — shared Flight type (id, callsign, lat/lon, heading, altitude, velocity)
```

### Redis cache keys

| Key | TTL | Contents |
|---|---|---|
| `flights:latest` | 130 s | Latest flight snapshot (list of flight dicts) |
| `flights:prev` | 130 s | Previous snapshot (rotated from latest on each fetch) |
| `flights:last_position:{icao24}` | 300 s | `{lat, lon}` used for heading calculation |

### Backend structure

```
backend/app/
  main.py                    — FastAPI app, lifespan (starts fetcher task, creates DB tables), CORS, WebSocket endpoint
  tasks/
    flight_fetcher.py        — background loop: fetch → Redis rotate → Postgres save → WS broadcast
  api/flights.py             — GET /live (Redis-first, API fallback) + build_live_flights_payload()
  models/
    flight_snapshot.py       — SQLAlchemy FlightSnapshot + FlightPosition ORM models
  schemas/flight.py          — Pydantic Flight model
  services/
    opensky.py               — OpenSky API client (OPENSKY_LOGIN/PASSWORD from env)
    heading.py               — Redis client + bearing calculation from successive positions
    cache.py                 — Redis get/set for flights:latest and flights:prev
    broadcast.py             — WebSocket ConnectionManager (asyncio.Queue per client, maxsize=2)
    repository.py            — Postgres: save_snapshot(), downsample_old_snapshots()
    database.py              — SQLAlchemy engine + session setup
```

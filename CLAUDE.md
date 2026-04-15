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
- `VITE_API_BASE_URL` — frontend env var pointing to backend (e.g. `http://localhost:8000`)
- `VITE_MAPTILER_KEY` — MapTiler API key for the map style

## Architecture

This is a real-time flight tracker with a Python/FastAPI backend and a React/TypeScript frontend.

### Data flow

1. **Backend** calls the OpenSky Network API (`backend/app/services/opensky.py`) to get live aircraft state vectors.
2. Heading is computed from successive positions stored in **Redis** (`backend/app/services/heading.py`). If Redis has no prior position, it falls back to the `true_track` field from OpenSky.
3. The `/flights/live` REST endpoint and the `/ws/flights` WebSocket endpoint (currently the frontend only uses REST) both serve the normalized `Flight` schema (`backend/app/schemas/flight.py`).

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
  FlightsMap.tsx      — map, projection switching, flight rendering, hover/select state
  FlightInfoCard.tsx  — sidebar card shown when a flight is clicked
  LoadingStatus.tsx   — overlay shown while loading
  ErrorStatus.tsx     — full-page error display
types/flight.ts       — shared Flight type (id, callsign, lat/lon, heading, altitude, velocity)
```

### Backend structure

```
backend/app/
  main.py              — FastAPI app, CORS middleware, WebSocket endpoint
  api/flights.py       — REST router + build_live_flights_payload()
  schemas/flight.py    — Pydantic Flight model
  services/
    opensky.py         — OpenSky API wrapper (reads OPENSKY_LOGIN/PASSWORD from env)
    heading.py         — Redis-backed heading computation from successive positions
```

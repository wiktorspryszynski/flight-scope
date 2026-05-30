# Flight-Scope — System Overview

Real-time flight tracker. Python/FastAPI backend ingests aircraft state vectors from OpenSky Network, caches them in Redis, persists snapshots to PostgreSQL, and streams updates to a React frontend via Server-Sent Events. The frontend animates aircraft movement by interpolating between server-provided previous and next positions.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Data Flow — Live Flights](#2-data-flow--live-flights)
3. [Data Flow — History / Time-Travel](#3-data-flow--history--time-travel)
4. [Data Flow — Aircraft Metadata](#4-data-flow--aircraft-metadata)
5. [Data Flow — Database Stats](#5-data-flow--database-stats)
6. [All Endpoints](#6-all-endpoints)
7. [Entity Relationships](#7-entity-relationships)
8. [Authentication Flow](#8-authentication-flow)
9. [Key Class / Function Dependencies](#9-key-class--function-dependencies)
10. [Frontend Component Tree](#10-frontend-component-tree)
11. [Infrastructure & Environment](#11-infrastructure--environment)
12. [Scaling Limits & Design Decisions](#12-scaling-limits--design-decisions)

---

## 1. High-Level Architecture

```
OpenSky Network OAuth2 API
         │
         │  GET /api/states/all  (every 120 s)
         ▼
┌────────────────────────────────────────────────────────────────┐
│  backend/app/tasks/flight_fetcher.py                           │
│  flight_fetcher_loop()                                         │
│  ├─ opensky.get_live_flights_raw()                             │
│  ├─ heading.calculate_heading_from_previous_position() ──► Redis│
│  ├─ cache.set_flights_cache()  ──────────────────────────► Redis│
│  ├─ repository.save_snapshot() ──────────────────────────► Postgres
│  └─ broadcast.broadcast()  ──────────────────────────────► SSE clients
└────────────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────────────────►
         │  Redis                                                │
         │  flights:latest (TTL 130 s)                           │
         │  flights:prev   (TTL 130 s)                           │
         │  flights:last_position:{icao24} (TTL 300 s)           │
         │                                                       │
         ├──────────────────────────────────────────────────────►
         │  PostgreSQL                                           │
         │  flight_snapshots  (one row per fetch cycle)          │
         │  flight_positions  (one row per aircraft per cycle)   │
         │                                                       │
         ▼                                                       │
┌────────────────────────────────────────────────────────────────┐
│  FastAPI (backend/app/main.py)                                 │
│  ├─ GET /api/flights/live       (Redis → Postgres fallback)    │
│  ├─ GET /api/sse/flights        (SSE stream)                   │
│  ├─ GET /api/flights/{id}/info  (OpenSky metadata + Redis)     │
│  ├─ GET /api/flights/{id}/history (Postgres)                   │
│  ├─ GET /api/flights/at         (Postgres snapshot lookup)     │
│  └─ GET /api/stats              (Postgres system catalog)      │
└────────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  React Frontend (frontend/src/)                                │
│  App.tsx                                                       │
│  ├─ EventSource → /api/sse/flights                             │
│  ├─ prevFlights / nextFlights state → FlightsMap              │
│  ├─ requestAnimationFrame interpolation loop                   │
│  └─ HistoryPanel → /api/flights/at?t={timestamp}              │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow — Live Flights

### Step 1 — Background fetch (server-side)

**File:** `backend/app/tasks/flight_fetcher.py` → `flight_fetcher_loop()`

Every `FLIGHT_FETCH_INTERVAL_SECONDS` (default 120):

1. Calls `get_flights_payload()` from `backend/app/api/flights.py`
   - If `DEV_DUMMY_DATA=true` → returns 5 hardcoded `_DUMMY_FLIGHTS`
   - Otherwise calls `build_live_flights_payload()`
     - Calls `opensky.get_live_flights_raw()` → HTTP GET `https://opensky-network.org/api/states/all`
     - Filters states that have valid lat/lon
     - For each aircraft, calls `heading.calculate_heading_from_previous_position(icao24, lat, lon)`
       - Reads `flights:last_position:{icao24}` from Redis
       - Writes current position back with TTL
       - Computes bearing via Haversine formula
       - Falls back to OpenSky `true_track` if no prior position
     - Returns list of `Flight` Pydantic objects

2. Reads previous cache: `cache.get_flights_prev_cache()` → Redis key `flights:prev`

3. Calls `cache.set_flights_cache(flights_data)`:
   - `flights:latest` → `flights:prev` (rotate)
   - New data → `flights:latest`
   - Both with TTL 130 s

4. Calls `repository.save_snapshot(flights_data)`:
   - Inserts one `FlightSnapshot` row (timestamp)
   - Bulk-inserts one `FlightPosition` row per aircraft

5. Calls `broadcast.broadcast({"prev": prev_data, "next": flights_data})`:
   - Puts payload into every registered client's `asyncio.Queue` (maxsize=2)

**Error handling:**
- `RateLimitError` (HTTP 429) → records hit in `rate_limit_tracker`, sleeps 5 min
- `OpenSkyTimeoutError` / `OpenSkyConnectionError` → broadcasts stale DB data, sleeps 5 min

### Step 2 — SSE endpoint

**File:** `backend/app/api/sse.py` → `GET /api/sse/flights`

1. Registers a new `asyncio.Queue` via `ConnectionManager.connect()`
2. Sends initial state immediately: reads `flights:latest` and `flights:prev` from Redis
3. Enters async generator loop: waits on queue, sends each payload as `data: {json}\n\n`
4. Sends keepalive `data: ping\n\n` every 30 s if no data arrives
5. On client disconnect: calls `ConnectionManager.disconnect(q)`

**Response headers:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no`
- `Connection: keep-alive`

### Step 3 — Frontend receives SSE

**File:** `frontend/src/App.tsx`

1. `EventSource` connects to `/api/sse/flights`
2. On `message`: parses `{ prev, next, stale?, noData? }`
3. Updates `prevFlights`, `nextFlights` state; sets `animationStartTime = Date.now()`
4. If no SSE message within 20 s → falls back to `GET /api/flights/live` REST poll

### Step 4 — Interpolated animation

**File:** `frontend/src/modules/FlightsMap.tsx`

`requestAnimationFrame` loop (throttled to ~30 updates/s):

1. `t = (Date.now() - animationStartTime) / animationDuration` (clamped 0–1)
2. `interpolateFlights(prevFlights, nextFlights, t)`:
   - For each flight in `nextFlights`, looks up matching `prevFlights` entry by `id`
   - `lerp(prevLat, nextLat, t)` / `lerp(prevLon, nextLon, t)`
   - `lerpHeading(prevHeading, nextHeading, t)` (shortest-path circular interpolation)
3. Updates MapLibre GeoJSON source `"flights"` with interpolated positions
4. Map renders icon layer `"flights-icons"` (rotated airplane SVG)

---

## 3. Data Flow — History / Time-Travel

**Trigger:** User selects a time in `HistoryPanel.tsx` → calls `onTimeSelect(t: number)`

**File:** `frontend/src/App.tsx` (effect watches `historyTime`)

1. Fetches `GET /api/flights/at?t={unix_timestamp_seconds}`
2. Sets `prevFlights = nextFlights = normalizeFlights(data.flights)` (no interpolation)
3. Sets `historyInfo = { resolvedTime: data.snapshot_time, isDownsampled: data.is_downsampled }`

**Backend handler:** `backend/app/api/flights.py` → route `GET /flights/at`

1. Two DB queries against `FlightPosition`:
   - One for snapshot with `snapshot_time <= t` (nearest-before)
   - One for snapshot with `snapshot_time >= t` (nearest-after)
2. Picks the snapshot closest to `t` by absolute time delta
3. Fetches all `FlightPosition` rows for that `snapshot_id`
4. Returns `SnapshotResponse`:
   - `snapshot_time`: ISO timestamp of matched snapshot
   - `flights`: list of `Flight` objects
   - `is_downsampled`: `True` if snapshot is older than 24 h (data at 5-min resolution)

**Hourly downsampling:** `repository.downsample_old_snapshots()` (called by `flight_fetcher_loop`)

- Keeps snapshots where position in 24 h window, deletes rest
- For snapshots > 24 h old: groups by 5-minute bucket, keeps one representative per bucket using SQL window functions
- Also enforces `MAX_SNAPSHOTS` cap (default 5000)

---

## 4. Data Flow — Aircraft Metadata

**Trigger:** User clicks a flight → `FlightInfoCard.tsx` mounts

**File:** `frontend/src/modules/FlightInfoCard.tsx`

1. `useEffect` on `flight.id` change → `GET /api/flights/{icao24}/info`
2. Renders `AircraftInfo`: registration, manufacturer, model, typecode, operator, built year

**Backend handler:** `backend/app/api/aircraft.py` → `GET /flights/{icao24}/info`

1. Checks Redis key `aircraft:info:{icao24}` (TTL 3600 s)
2. Cache miss → GET `https://opensky-network.org/api/metadata/aircraft/icao/{icao24}` with Bearer token
3. Stores result in Redis for 3600 s
4. Returns `AircraftInfo` Pydantic model

---

## 5. Data Flow — Database Stats

**File:** `backend/app/api/stats.py` → `GET /api/stats`

Runs raw SQL against PostgreSQL system catalog:

| Metric | SQL used |
|---|---|
| `snapshot_count` | `COUNT(*)` on `flight_snapshots` |
| `position_count` | `COUNT(*)` on `flight_positions` |
| `db_size_bytes` | `pg_database_size(current_database())` |
| `positions_table_size_pretty` | `pg_size_pretty(pg_relation_size('flight_positions'))` |
| `oldest_snapshot` / `newest_snapshot` | `MIN(snapshot_time)` / `MAX(snapshot_time)` |
| `snapshots_last_24h` | `COUNT(*)` with time filter |
| `rate_limit_hits_24h` | In-memory `deque` in `rate_limit_tracker.py` |

Returns `DBStats` Pydantic model. Consumed by `DBDashboard.tsx` (`/admin/db-stats`) and `DBStatsPanel.tsx`.

---

## 6. All Endpoints

### Backend (FastAPI)

| Method | Path | Handler | Input | Output |
|---|---|---|---|---|
| `GET` | `/api/flights/live` | `api/flights.py` | — | `list[Flight]` (Redis cache, DB fallback) |
| `GET` | `/api/flights/at` | `api/flights.py` | `?t={unix_seconds}` | `SnapshotResponse { snapshot_time, flights, is_downsampled }` |
| `GET` | `/api/flights/{icao24}/info` | `api/aircraft.py` | path param | `AircraftInfo` (Redis cache, OpenSky fallback) |
| `GET` | `/api/flights/{icao24}/history` | `api/aircraft.py` | `?hours=6` (1–24) | `list[HistoryPoint]` from Postgres |
| `GET` | `/api/sse/flights` | `api/sse.py` | — | `text/event-stream` (continuous `{ prev, next }` JSON) |
| `GET` | `/api/stats` | `api/stats.py` | — | `DBStats` |

### Frontend Routes (React Router)

| Path | Component | Description |
|---|---|---|
| `/` | `App.tsx` → `FlightsMap.tsx` | Main map view with live flights |
| `/admin/db-stats` | `DBDashboard.tsx` | Database metrics dashboard |

---

## 7. Entity Relationships

### PostgreSQL ORM (`backend/app/models/flight_snapshot.py`)

```
FlightSnapshot
 ├─ id: BigInteger PK
 ├─ snapshot_time: DateTime(tz=True)
 └─ positions: relationship(FlightPosition, cascade="all, delete-orphan")

FlightPosition
 ├─ id: BigInteger PK
 ├─ snapshot_id: FK → FlightSnapshot.id  (many-to-one)
 ├─ snapshot_time: DateTime (denormalized for index efficiency)
 ├─ icao24: Text
 ├─ callsign: Text | NULL
 ├─ latitude: Double
 ├─ longitude: Double
 ├─ heading: Float | NULL
 ├─ altitude: Float | NULL
 └─ velocity: Float | NULL

Indexes:
 - FlightPosition(icao24, snapshot_time)   — aircraft history queries
 - FlightPosition(snapshot_time)           — time-range lookups
```

One `FlightSnapshot` → many `FlightPosition` rows (one per aircraft visible at that time).

### Redis Keys

| Key pattern | TTL | Contents |
|---|---|---|
| `flights:latest` | 130 s | JSON list of current flight dicts |
| `flights:prev` | 130 s | JSON list of previous flight dicts (for interpolation) |
| `flights:last_position:{icao24}` | 300 s | `{"lat": float, "lon": float}` used for heading calc |
| `aircraft:info:{icao24}` | 3600 s | JSON OpenSky metadata response |

### Pydantic Schemas

| Schema | File | Used by |
|---|---|---|
| `Flight` | `schemas/flight.py` | API responses, Redis serialization |
| `AircraftInfo` | `api/aircraft.py` | `/info` endpoint |
| `HistoryPoint` | `api/aircraft.py` | `/history` endpoint |
| `SnapshotResponse` | `api/flights.py` | `/at` endpoint |
| `DBStats` | `api/stats.py` | `/stats` endpoint |

---

## 8. Authentication Flow

### OpenSky Network (server-side OAuth2)

**File:** `backend/app/services/opensky.py` → `TokenManager` class

```
TokenManager (singleton-like, module-level instance)
│
├─ get_auth_headers() called before every OpenSky request
│
├─ If OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET set:
│   ├─ Check if token valid (expiry - 30 s margin)
│   ├─ If expired → POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
│   │   Body: grant_type=client_credentials, client_id, client_secret
│   │   Response: { access_token, expires_in }
│   └─ Return { "Authorization": "Bearer {token}" }
│
└─ If no credentials → return {} (unauthenticated, stricter rate limits)
```

Token is held in memory; not persisted to Redis. Thread-safe field update.

### User Authentication

There is **no user authentication** in this application. All API endpoints are public. The `/admin/db-stats` frontend route is accessible without any login.

---

## 9. Key Class / Function Dependencies

```
flight_fetcher_loop()                          [tasks/flight_fetcher.py]
 ├─► get_flights_payload()                     [api/flights.py]
 │    ├─► get_live_flights_raw()               [services/opensky.py]
 │    │    └─► TokenManager.get_auth_headers() [services/opensky.py]
 │    └─► calculate_heading_from_previous_position()  [services/heading.py]
 │         └─► get_redis_client()              [services/heading.py]
 ├─► get_flights_prev_cache()                  [services/cache.py]
 │    └─► get_redis_client() (shared singleton)
 ├─► set_flights_cache()                       [services/cache.py]
 ├─► save_snapshot()                           [db/repository.py]
 │    └─► SessionLocal()                       [db/database.py]
 ├─► broadcast()                               [services/broadcast.py]
 │    └─► ConnectionManager._queues            [services/broadcast.py]
 └─► downsample_old_snapshots() (hourly)       [db/repository.py]

GET /api/flights/live                          [api/flights.py]
 ├─► get_flights_cache()                       [services/cache.py]
 ├─► get_flights_payload() (cache miss)        [api/flights.py]
 └─► get_latest_snapshot_flights() (fallback)  [db/repository.py]

GET /api/sse/flights                           [api/sse.py]
 ├─► ConnectionManager.connect()               [services/broadcast.py]
 ├─► get_flights_cache() + get_flights_prev_cache()  [services/cache.py]
 └─► ConnectionManager.disconnect()            [services/broadcast.py]

GET /api/flights/{icao24}/info                 [api/aircraft.py]
 ├─► get_redis_client() (cache check/write)    [services/heading.py]
 └─► TokenManager.get_auth_headers()           [services/opensky.py]

GET /api/flights/at                            [api/flights.py]
 └─► SessionLocal()                            [db/database.py]

GET /api/stats                                 [api/stats.py]
 ├─► SessionLocal()                            [db/database.py]
 └─► rate_limit_tracker.hits_in_last()         [services/rate_limit_tracker.py]
```

---

## 10. Frontend Component Tree

```
main.tsx
└─ BrowserRouter
   ├─ Route "/" → App.tsx
   │   ├─ State: prevFlights, nextFlights, animationStartTime, historyTime, dataRange
   │   ├─ Effect: fetch /api/stats → dataRange
   │   ├─ Effect: EventSource /api/sse/flights → prevFlights/nextFlights + animationStartTime
   │   ├─ Effect: historyTime change → fetch /api/flights/at?t= → prevFlights/nextFlights
   │   │
   │   ├─ FlightsMap.tsx          — core map component
   │   │   ├─ MapLibre <Map>       — base map (MapTiler tiles)
   │   │   │   ├─ Source "flights" (GeoJSON)
   │   │   │   │   └─ Layer "flights-icons" (symbol, SVG airplane rotated by heading)
   │   │   │   ├─ Source "flight-trail" (GeoJSON LineString)
   │   │   │   │   └─ Layer "flight-trail-layer" (line)
   │   │   │   └─ 3D buildings layer (added in spectate mode)
   │   │   ├─ PlaneScenegraphLayer.tsx  — deck.gl 3D GLTF model (selected flight)
   │   │   │   └─ MapboxOverlay + ScenegraphLayer (airbus_a319.glb)
   │   │   └─ rAF loop: interpolateFlights() → update GeoJSON source every ~33 ms
   │   │
   │   ├─ FlightInfoCard.tsx      — shown when flight selected
   │   │   └─ fetches /api/flights/{icao24}/info on mount
   │   │
   │   ├─ HistoryPanel.tsx        — time-travel controls
   │   │   └─ calls onTimeSelect(t) → App historyTime state
   │   │
   │   ├─ DBStatsPanel.tsx        — collapsible stats widget
   │   │   └─ fetches /api/stats on expand
   │   │
   │   ├─ LoadingStatus.tsx       — spinner overlay (while isLoading)
   │   ├─ ErrorStatus.tsx         — full-page error (missing env vars)
   │   └─ Credits.tsx             — attribution overlay
   │
   └─ Route "/admin/db-stats" → DBDashboard.tsx
       └─ fetches /api/stats on mount, auto-refresh
```

**Shared type:** `frontend/src/types/flight.ts` → `Flight { id, callsign, latitude, longitude, heading?, altitude?, velocity? }`

---

## 11. Infrastructure & Environment

### Docker Compose Services

| Service | Image / Build | Port (host) | Depends on |
|---|---|---|---|
| `backend` | `backend/Dockerfile` | `127.0.0.1:8000` | postgres (healthy), redis |
| `frontend` (prod profile) | `frontend/Dockerfile` | `127.0.0.1:5173:80` | backend |
| `frontend-dev` (dev profile) | `frontend/Dockerfile.dev` | `127.0.0.1:5173:5173` | backend |
| `postgres` | `postgres:15` | `127.0.0.1:5432` | — |
| `redis` | `redis:7` | `127.0.0.1:6379` | — |

### Required Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | `services/opensky.py` | OAuth2 for higher rate limits |
| `POSTGRES_USER/PASSWORD/DB` | `db/database.py` | Connection string |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `db/database.py` | Defaults: `postgres` / `5432` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | `services/heading.py` | Defaults: `redis` / `6379` / `0` |
| `FLIGHT_FETCH_INTERVAL_SECONDS` | `tasks/flight_fetcher.py` | Default: `120` |
| `FLIGHT_POSITION_TTL_SECONDS` | `services/heading.py` | Heading cache TTL, default: `300` |
| `MAX_SNAPSHOTS` | `db/repository.py` | DB cap, default: `5000` |
| `DEV_DUMMY_DATA` | `api/flights.py` | `"true"` uses static fixtures |
| `VITE_API_BASE_URL` | `frontend/src/App.tsx` | Backend URL, required |
| `VITE_MAPTILER_KEY` | `frontend/src/App.tsx` | Map tiles, required |
| `VITE_FLIGHT_FETCH_INTERVAL_SECONDS` | `frontend/src/App.tsx` | Build-time interval constant |

### Backend file structure

```
backend/app/
 main.py                     — FastAPI app, lifespan, CORS, router registration
 tasks/
   flight_fetcher.py         — background fetch loop
 api/
   flights.py                — /live, /at routes + build_live_flights_payload()
   aircraft.py               — /info, /history routes
   sse.py                    — /sse/flights SSE endpoint
   stats.py                  — /stats endpoint
 models/
   flight_snapshot.py        — SQLAlchemy ORM: FlightSnapshot + FlightPosition
 schemas/
   flight.py                 — Pydantic Flight schema
 services/
   opensky.py                — OpenSky HTTP client + TokenManager
   heading.py                — Redis client + Haversine bearing
   cache.py                  — Redis get/set for flights:latest, flights:prev
   broadcast.py              — SSE ConnectionManager (asyncio.Queue per client)
   repository.py             — Postgres: save_snapshot(), downsample_old_snapshots(), get_latest_snapshot_flights()
   rate_limit_tracker.py     — In-memory deque of 429 hit timestamps
 db/
   database.py               — SQLAlchemy engine + SessionLocal
```

---

## 12. Scaling Limits & Design Decisions

### Hard limits

| Limit | Value | Where |
|---|---|---|
| Max rendered flights (Mercator) | 800 | `FlightsMap.tsx: MAX_MERCATOR_RENDERED_FLIGHTS` |
| Max rendered flights (Globe) | 520 | `FlightsMap.tsx: MAX_GLOBE_RENDERED_FLIGHTS` |
| SSE per-client queue | maxsize=2 | `broadcast.py: ConnectionManager` |
| Max DB snapshots | 5000 (configurable) | `repository.py: MAX_SNAPSHOTS` |
| History full-resolution window | 24 h | `repository.py: downsample_old_snapshots()` |
| Downsampled resolution (> 24 h) | 5-minute buckets | `repository.py` |
| Aircraft metadata cache | 3600 s | `api/aircraft.py` |
| OpenSky backoff on 429 | 5 minutes | `tasks/flight_fetcher.py` |

### Key design choices

- **SSE over WebSocket:** Unidirectional broadcast is sufficient; simpler proxy config (no WS upgrade routing).
- **Redis rotation (latest → prev):** Clients that connect mid-cycle get both prev and next, enabling interpolation immediately without waiting for a second fetch.
- **Client-side interpolation:** Decouples visual smoothness from server fetch frequency; heading uses circular shortest-path lerp to avoid 359° → 0° snap.
- **Dual projection rendering:** Globe uses DOM `<Marker>` elements (simpler, fewer flights); Mercator switches to deck.gl `IconLayer` (GPU-accelerated, handles 800+).
- **PostgreSQL for history:** Append-only time-series writes; downsampling keeps table bounded without a dedicated TSDB. Index on `(icao24, snapshot_time)` enables O(log n) aircraft history queries.
- **Rate limit tracker in-memory:** Simple deque; resets on restart; not safe for multi-worker deployments (would need Redis counter).
- **No user auth:** All endpoints are public; `/admin/db-stats` is security-through-obscurity only.

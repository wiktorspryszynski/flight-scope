# TODO

- [ ] Credits
- [X] Spectate live 3d airplane
- [ ] ML of flight data — route clustering (DBSCAN on historical positions → corridor heatmap)
- [ ] Rate limit (client-side)
- [X] Redis fallback if opensky limit hit
- [ ] Show stale data warning in UI when WS/SSE payload includes `"stale": true` (e.g. banner or badge)
- [X] Better airplane info modal — metadata from OpenSky (registration, model, operator, built year)
- [X] Single airplane info API — GET /api/flights/{icao24}/info + history trail
- [X] Database size monitor — GET /api/stats (snapshot count, positions, DB size, 24 h health indicator)
- [X] Change websocket to SSE — GET /api/sse/flights with keepalive

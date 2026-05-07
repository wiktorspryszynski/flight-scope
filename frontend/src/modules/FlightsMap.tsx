import { useCallback, useEffect, useRef, useState } from 'react'
import MapGL, { type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LngLat } from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import type { Flight } from '../types/flight'
import FlightInfoCard from './FlightInfoCard'
import { PlaneScenegraphLayer, type AnimatedPosition } from './PlaneScenegraphLayer'

type FlightsMapProps = {
  maptilerKey: string
  prevFlights: Flight[]
  nextFlights: Flight[]
  animationStartTime: number
  animationDuration: number
}

type ProjectionType = 'globe' | 'mercator'

const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5
const PITCH_RESET_ZOOM_THRESHOLD = 7
const MAX_RENDERED_FLIGHTS = 6000
const ICAO24_REGEX = /^[0-9a-f]{6}$/i
const SOURCE_ID = 'flights'
const LAYER_ID = 'flights-icons'
const BUILDINGS_LAYER_ID = 'buildings-3d'
const ICON_NAME = 'airplane'
const COLOR_DEFAULT = '#ff5a00'
const COLOR_ACTIVE = '#a855f7'

// Top-down airplane silhouette pointing north (0°). White fill enables SDF colorization.
const AIRPLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path fill="white" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`

// ─── Interpolation helpers ────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Shortest-path circular lerp for heading (degrees). */
const lerpHeading = (a: number, b: number, t: number) => {
  const delta = ((b - a + 540) % 360) - 180
  return (a + delta * t + 360) % 360
}

const buildFlightMap = (flights: Flight[]) =>
  new Map(flights.map((f) => [f.id, f]))

function interpolateFlights(prev: Flight[], next: Flight[], t: number): Flight[] {
  const prevMap = buildFlightMap(prev)
  return next.slice(0, MAX_RENDERED_FLIGHTS).map((n) => {
    const p = prevMap.get(n.id)
    if (!p) return n
    return {
      ...n,
      longitude: lerp(p.longitude, n.longitude, t),
      latitude: lerp(p.latitude, n.latitude, t),
      heading:
        p.heading !== undefined && n.heading !== undefined
          ? lerpHeading(p.heading, n.heading, t)
          : (n.heading ?? p.heading),
    }
  })
}

// ─── GeoJSON / MapLibre helpers ───────────────────────────────────────────────

const buildGeoJson = (flights: Flight[]) => ({
  type: 'FeatureCollection' as const,
  features: flights.map((f) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [f.longitude, f.latitude] as [number, number] },
    properties: { id: f.id, callsign: f.callsign, heading: f.heading ?? 0 },
  })),
})

const buildColorExpression = (selectedId: string | null, hoveredId: string | null) => [
  'case',
  ['any', ['==', ['get', 'id'], selectedId ?? '\x00'], ['==', ['get', 'id'], hoveredId ?? '\x00']],
  COLOR_ACTIVE,
  COLOR_DEFAULT,
]

const normalizeProjection = (type: unknown): ProjectionType =>
  type === 'mercator' ? 'mercator' : 'globe'

// ─── Component ────────────────────────────────────────────────────────────────

function FlightsMap({ maptilerKey, prevFlights, nextFlights, animationStartTime, animationDuration }: FlightsMapProps) {
  const mapRef = useRef<MapRef | null>(null)
  const prevZoomRef = useRef(INITIAL_ZOOM)

  // rAF animation
  const animFrameRef = useRef<number>(0)
  const frameCountRef = useRef(0)
  // Ref updated every tick so PlaneScenegraphLayer always reads latest position
  const spectatedPositionRef = useRef<AnimatedPosition>({ longitude: 0, latitude: 0, heading: 0 })
  const spectatedFlightIdRef = useRef<string | null>(null)
  // Tracks the last known position of the spectated flight so we can pan by delta each frame
  const spectatedPrevLngLatRef = useRef<{ lng: number; lat: number } | null>(null)
  // User-applied camera offset from the spectated flight (lng/lat degrees)
  const spectateOffsetRef = useRef<{ dLng: number; dLat: number }>({ dLng: 0, dLat: 0 })
  const isInteractingRef = useRef(false)

  const camParamsRef = useRef({ camDist: 0.01, camAlt: 2500, camTargetAlt: 0 })

  const [projectionType, setProjectionType] = useState<ProjectionType>(
    INITIAL_ZOOM >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe',
  )
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null)
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null)
  const [spectatedFlightId, setSpectatedFlightIdState] = useState<string | null>(null)
  const setSpectatedFlightId = (id: string | null) => {
    spectatedFlightIdRef.current = id
    if (!id) spectatedPrevLngLatRef.current = null
    setSpectatedFlightIdState(id)
  }
  const [hoveredIcaoTooltip, setHoveredIcaoTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  const isGlobeProjection = projectionType === 'globe'

  // Derive selected/spectated flight objects from nextFlights (latest positions)
  const selectedFlight = selectedFlightId
    ? (nextFlights.find((f) => f.id === selectedFlightId) ?? null)
    : null
  const spectatedFlight = spectatedFlightId
    ? (nextFlights.find((f) => f.id === spectatedFlightId) ?? null)
    : null

  // ─── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current)

    const tick = () => {
      const t = Math.min(1, (Date.now() - animationStartTime) / animationDuration)
      frameCountRef.current += 1

      // Throttle source update to ~30 fps (every other frame)
      if (frameCountRef.current % 2 === 0) {
        const map = mapRef.current?.getMap()
        const source = map?.getSource(SOURCE_ID) as GeoJSONSource | undefined
        if (source) {
          const interpolated = interpolateFlights(prevFlights, nextFlights, t)
          source.setData(buildGeoJson(interpolated))

          if (spectatedFlightId) {
            const sf = interpolated.find((f) => f.id === spectatedFlightId)
            if (sf) {
              spectatedPositionRef.current = {
                longitude: sf.longitude,
                latitude: sf.latitude,
                heading: sf.heading ?? 0,
                altitude: sf.altitude,
              }
              if (map) {
                const prev = spectatedPrevLngLatRef.current
                if (prev && !isInteractingRef.current) {
                  map.jumpTo({
                    center: [
                      sf.longitude + spectateOffsetRef.current.dLng,
                      sf.latitude + spectateOffsetRef.current.dLat,
                    ],
                  })
                }
                spectatedPrevLngLatRef.current = { lng: sf.longitude, lat: sf.latitude }
              }
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [prevFlights, nextFlights, animationStartTime, animationDuration, spectatedFlightId])

  // ─── Spectate mode: add/remove buildings layer ───────────────────────────────

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const applyLayers = () => {
      if (spectatedFlightId) {
        if (!map.getLayer(BUILDINGS_LAYER_ID)) {
          const sources = map.getStyle()?.sources ?? {}
          const buildingSource = Object.keys(sources).find((k) => {
            const s = sources[k] as { type?: string }
            return s.type === 'vector'
          })
          if (buildingSource) {
            map.addLayer(
              {
                id: BUILDINGS_LAYER_ID,
                type: 'fill-extrusion',
                source: buildingSource,
                'source-layer': 'building',
                paint: {
                  'fill-extrusion-color': '#1a1f2e',
                  'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
                  'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                  'fill-extrusion-opacity': 0.85,
                },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
              LAYER_ID,
            )
          }
        }
      } else {
        if (map.getLayer(BUILDINGS_LAYER_ID)) map.removeLayer(BUILDINGS_LAYER_ID)
      }
    }

    if (map.isStyleLoaded()) {
      applyLayers()
    } else {
      map.once('styledata', applyLayers)
    }
    return () => { map.off('styledata', applyLayers) }
  }, [spectatedFlightId])

  // ─── ESC to exit spectate ────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSpectatedFlightId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ─── Icon colors ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map?.getLayer(LAYER_ID)) return
    map.setPaintProperty(LAYER_ID, 'icon-color', buildColorExpression(selectedFlightId, hoveredFlightId))
  }, [selectedFlightId, hoveredFlightId])

  // ─── Projection / zoom sync ──────────────────────────────────────────────────

  const syncProjectionWithZoom = useCallback((zoom: number) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const target: ProjectionType = zoom >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe'
    const current = normalizeProjection(map.getProjection()?.type)

    if (current !== target) {
      map.setProjection({ type: target })
      if (target === 'mercator') map.easeTo({ bearing: 0, duration: 0 })
      if (target === 'globe') map.easeTo({ bearing: 0, pitch: 0, duration: 300 })
    }

    const prevZoom = prevZoomRef.current
    prevZoomRef.current = zoom
    if (prevZoom >= PITCH_RESET_ZOOM_THRESHOLD && zoom < PITCH_RESET_ZOOM_THRESHOLD) {
      map.easeTo({ pitch: 0, duration: 300 })
    }

    map.setMaxPitch(target === 'mercator' ? 60 : 0)
    setProjectionType((prev) => (prev === target ? prev : target))
  }, [])

  // ─── MapLibre event handlers (stable refs) ──────────────────────────────────

  const handleLayerClick = useCallback((e: MapLayerMouseEvent) => {
    const id: string | null = e.features?.[0]?.properties?.id ?? null
    setSelectedFlightId(id)
    setHoveredFlightId(null)
    setHoveredIcaoTooltip(null)
  }, [])

  const handleLayerHover = useCallback((e: MapLayerMouseEvent) => {
    const id: string = e.features?.[0]?.properties?.id ?? ''
    setHoveredFlightId(id || null)
    const icao24 = id && ICAO24_REGEX.test(id) ? id.toUpperCase() : null
    setHoveredIcaoTooltip(icao24 ? { text: icao24, x: e.point.x, y: e.point.y } : null)
    const canvas = mapRef.current?.getMap().getCanvas()
    if (canvas) canvas.style.cursor = 'pointer'
  }, [])

  const handleLayerLeave = useCallback(() => {
    setHoveredFlightId(null)
    setHoveredIcaoTooltip(null)
    const canvas = mapRef.current?.getMap().getCanvas()
    if (canvas) canvas.style.cursor = ''
  }, [])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] }).length > 0) return
    if (spectatedFlightIdRef.current) return
    setSelectedFlightId(null)
    setSpectatedFlightId(null)
    setHoveredFlightId(null)
    setHoveredIcaoTooltip(null)
  }, [])

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const img = new Image(32, 32)
    img.onload = () => {
      if (!map.hasImage(ICON_NAME)) {
        map.addImage(ICON_NAME, img, { sdf: true })
      }

      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: buildGeoJson([]) })
      }

      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          layout: {
            'icon-image': ICON_NAME,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.38, 6, 0.52, 10, 0.72],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          paint: {
            'icon-color': COLOR_DEFAULT,
            'icon-opacity': 0.9,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        })

        map.on('click', LAYER_ID, handleLayerClick)
        map.on('mousemove', LAYER_ID, handleLayerHover)
        map.on('mouseleave', LAYER_ID, handleLayerLeave)

        // Snap bearing to north on rotate end in mercator mode (not while spectating)
        map.on('rotateend', () => {
          if (spectatedFlightIdRef.current) return
          if (normalizeProjection(map.getProjection()?.type) === 'mercator') {
            map.setBearing(0)
          }
        })
      }

      syncProjectionWithZoom(INITIAL_ZOOM)
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(AIRPLANE_SVG)
  }, [handleLayerClick, handleLayerHover, handleLayerLeave, syncProjectionWithZoom])

  // ─── Spectate interaction helper ─────────────────────────────────────────────

  const syncSpectateOffset = useCallback(() => {
    if (!spectatedFlightIdRef.current) return
    const map = mapRef.current?.getMap()
    const flight = spectatedPrevLngLatRef.current
    if (map && flight) {
      const center = map.getCenter()
      spectateOffsetRef.current = {
        dLng: center.lng - flight.lng,
        dLat: center.lat - flight.lat,
      }
    }
  }, [])

  // ─── Spectate camera helper ──────────────────────────────────────────────────

  const applySpectateCameraFlyTo = useCallback(
    (map: ReturnType<MapRef['getMap']>, lng: number, lat: number, heading: number, targetAlt?: number, duration = 2000) => {
      const { camDist, camAlt } = camParamsRef.current
      const headingRad = (heading * Math.PI) / 180
      const camLng = lng - camDist * Math.sin(headingRad)
      const camLat = lat - camDist * Math.cos(headingRad)
      const camOptions = map.calculateCameraOptionsFromTo(
        new LngLat(camLng, camLat),
        camAlt,
        new LngLat(lng, lat),
        targetAlt ?? camParamsRef.current.camTargetAlt,
      )
      map.flyTo({ ...camOptions, duration })
    },
    [],
  )

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flight-map-wrapper">
      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM }}
        onLoad={handleMapLoad}
        onClick={handleMapClick}
        onDragStart={() => {
          setHoveredFlightId(null)
          setHoveredIcaoTooltip(null)
          isInteractingRef.current = true
        }}
        onDragEnd={() => { isInteractingRef.current = false; syncSpectateOffset() }}
        onZoomStart={() => { isInteractingRef.current = true }}
        onZoomEnd={() => { isInteractingRef.current = false; syncSpectateOffset() }}
        onRotateStart={() => { isInteractingRef.current = true }}
        onRotateEnd={() => { isInteractingRef.current = false; syncSpectateOffset() }}
        onPitchStart={() => { isInteractingRef.current = true }}
        onPitchEnd={() => { isInteractingRef.current = false }}
        onMoveEnd={(e) => {
          if (!spectatedFlightId) syncProjectionWithZoom(e.viewState.zoom)
        }}
        dragRotate
        maxPitch={isGlobeProjection && !spectatedFlightId ? 0 : 60}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      >
        <div className="flight-counter">
          Flights: {nextFlights.length}
        </div>
        {hoveredIcaoTooltip ? (
          <div
            className="flight-icao-tooltip"
            style={{ left: `${hoveredIcaoTooltip.x + 12}px`, top: `${hoveredIcaoTooltip.y - 28}px` }}
          >
            {hoveredIcaoTooltip.text}
          </div>
        ) : null}
        {selectedFlight ? (
          <FlightInfoCard
            flight={selectedFlight}
            isSpectating={spectatedFlightId === selectedFlight.id}
            onClose={() => {
              setSelectedFlightId(null)
              setSpectatedFlightId(null)
            }}
            onSpectate={(id) => {
              const flight = nextFlights.find((f) => f.id === id)
              const next = spectatedFlightId === id ? null : id
              if (flight) {
                const t = Math.min(1, (Date.now() - animationStartTime) / animationDuration)
                const prev = prevFlights.find((f) => f.id === id)
                const curLng = prev ? lerp(prev.longitude, flight.longitude, t) : flight.longitude
                const curLat = prev ? lerp(prev.latitude, flight.latitude, t) : flight.latitude
                const curHeading =
                  prev && prev.heading !== undefined && flight.heading !== undefined
                    ? lerpHeading(prev.heading, flight.heading, t)
                    : (flight.heading ?? 0)
                const curAlt = prev?.altitude != null && flight.altitude != null
                  ? lerp(prev.altitude, flight.altitude, t)
                  : (flight.altitude ?? prev?.altitude)
                spectatedPositionRef.current = { longitude: curLng, latitude: curLat, heading: curHeading, altitude: curAlt }
                spectatedPrevLngLatRef.current = { lng: curLng, lat: curLat }
                spectateOffsetRef.current = { dLng: 0, dLat: 0 }
                if (next) {
                  syncProjectionWithZoom(13)
                  const map = mapRef.current?.getMap()
                  if (map) {
                  const renderAlt = curAlt != null
                    ? Math.min(1, curAlt / 10_000) * 800
                    : 800
                  applySpectateCameraFlyTo(map, curLng, curLat, curHeading, renderAlt)
                }
                }
              }
              setSpectatedFlightId(next)
            }}
          />
        ) : null}
        {spectatedFlight && spectatedFlightId ? (
          <button
            type="button"
            className="spectate-exit-btn"
            onClick={() => setSpectatedFlightId(null)}
          >
            Exit spectate
          </button>
        ) : null}
      </MapGL>
      {spectatedFlightId ? (
        <PlaneScenegraphLayer mapRef={mapRef} positionRef={spectatedPositionRef} />
      ) : null}
    </div>
  )
}

export default FlightsMap

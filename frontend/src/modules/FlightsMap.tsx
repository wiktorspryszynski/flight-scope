import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import type { Flight } from '../types/flight'
import FlightInfoCard from './FlightInfoCard'

type FlightsMapProps = {
  maptilerKey: string
  flights: Flight[]
}

type ProjectionType = 'globe' | 'mercator'

const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5
const PITCH_RESET_ZOOM_THRESHOLD = 9
const MAX_RENDERED_FLIGHTS = 6000
const ICAO24_REGEX = /^[0-9a-f]{6}$/i
const SOURCE_ID = 'flights'
const LAYER_ID = 'flights-icons'
const ICON_NAME = 'airplane'
const COLOR_DEFAULT = '#ff5a00'
const COLOR_ACTIVE = '#a855f7'

// Top-down airplane silhouette pointing north (0°). White fill on transparent background
// enables SDF colorization via icon-color.
const AIRPLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path fill="white" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`

const buildGeoJson = (flights: Flight[]) => ({
  type: 'FeatureCollection' as const,
  features: flights.slice(0, MAX_RENDERED_FLIGHTS).map((flight) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [flight.longitude, flight.latitude] as [number, number],
    },
    properties: {
      id: flight.id,
      callsign: flight.callsign,
      heading: flight.heading ?? 0,
    },
  })),
})

// Returns a MapLibre expression that colors active (selected/hovered) flights purple,
// all others orange. Uses a sentinel that never matches a real ICAO24 when nothing is active.
const buildColorExpression = (selectedId: string | null, hoveredId: string | null) => [
  'case',
  [
    'any',
    ['==', ['get', 'id'], selectedId ?? '\x00'],
    ['==', ['get', 'id'], hoveredId ?? '\x00'],
  ],
  COLOR_ACTIVE,
  COLOR_DEFAULT,
]

const normalizeProjection = (type: unknown): ProjectionType =>
  type === 'mercator' ? 'mercator' : 'globe'

function FlightsMap({ maptilerKey, flights }: FlightsMapProps) {
  const mapRef = useRef<MapRef | null>(null)
  const flightsRef = useRef(flights)
  const prevZoomRef = useRef(INITIAL_ZOOM)

  const [projectionType, setProjectionType] = useState<ProjectionType>(
    INITIAL_ZOOM >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe',
  )
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null)
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null)
  const [hoveredIcaoTooltip, setHoveredIcaoTooltip] = useState<{
    text: string
    x: number
    y: number
  } | null>(null)

  const isGlobeProjection = projectionType === 'globe'

  const selectedFlight = useMemo(
    () => (selectedFlightId ? flights.find((f) => f.id === selectedFlightId) ?? null : null),
    [flights, selectedFlightId],
  )

  useEffect(() => {
    flightsRef.current = flights
  }, [flights])

  // Push updated flight positions into the GeoJSON source — no layer rebuild needed.
  useEffect(() => {
    const source = mapRef.current?.getMap().getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(buildGeoJson(flights))
  }, [flights])

  // Update icon colors when selection/hover changes — only a paint property update, no re-upload.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map?.getLayer(LAYER_ID)) return
    map.setPaintProperty(LAYER_ID, 'icon-color', buildColorExpression(selectedFlightId, hoveredFlightId))
  }, [selectedFlightId, hoveredFlightId])

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

    // Reset pitch when zooming out past the threshold (only on the downward crossing).
    const prevZoom = prevZoomRef.current
    prevZoomRef.current = zoom
    if (prevZoom >= PITCH_RESET_ZOOM_THRESHOLD && zoom < PITCH_RESET_ZOOM_THRESHOLD) {
      map.easeTo({ pitch: 0, duration: 300 })
    }

    map.setMaxPitch(target === 'mercator' ? 60 : 0)

    setProjectionType((prev) => (prev === target ? prev : target))
  }, [])

  // Stable MapLibre event handlers — registered once in handleMapLoad.
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

  // Background click: deselect only if the click didn't land on a flight icon.
  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] }).length > 0) return
    setSelectedFlightId(null)
    setHoveredFlightId(null)
    setHoveredIcaoTooltip(null)
  }, [])

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const img = new Image(32, 32)
    img.onload = () => {
      if (!map.hasImage(ICON_NAME)) {
        // sdf: true lets MapLibre colorize the icon via the icon-color paint property.
        map.addImage(ICON_NAME, img, { sdf: true })
      }

      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: buildGeoJson(flightsRef.current),
        })
      }

      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          layout: {
            'icon-image': ICON_NAME,
            // Scale icon with zoom so it doesn't clutter at global view.
            'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.38, 6, 0.52, 10, 0.72],
            // Rotate the icon to match geographic heading (degrees clockwise from north).
            'icon-rotate': ['get', 'heading'],
            // 'map' alignment keeps heading correct in both globe and mercator projections.
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

        // Snap bearing back to north after each rotate gesture in mercator mode.
        map.on('rotateend', () => {
          if (normalizeProjection(map.getProjection()?.type) === 'mercator') {
            map.setBearing(0)
          }
        })
      }

      syncProjectionWithZoom(INITIAL_ZOOM)
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(AIRPLANE_SVG)
  }, [handleLayerClick, handleLayerHover, handleLayerLeave, syncProjectionWithZoom])

  return (
    <div className="flight-map-wrapper">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM }}
        onLoad={handleMapLoad}
        onClick={handleMapClick}
        onDragStart={() => {
          setHoveredFlightId(null)
          setHoveredIcaoTooltip(null)
        }}
        onMoveEnd={(e) => syncProjectionWithZoom(e.viewState.zoom)}
        dragRotate
        maxPitch={isGlobeProjection ? 0 : 60}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      >
        <div className="flight-counter">
          Flights: {Math.min(flights.length, MAX_RENDERED_FLIGHTS)} / {flights.length}
        </div>
        {hoveredIcaoTooltip ? (
          <div
            className="flight-icao-tooltip"
            style={{
              left: `${hoveredIcaoTooltip.x + 12}px`,
              top: `${hoveredIcaoTooltip.y - 28}px`,
            }}
          >
            {hoveredIcaoTooltip.text}
          </div>
        ) : null}
        {selectedFlight ? (
          <FlightInfoCard flight={selectedFlight} onClose={() => setSelectedFlightId(null)} />
        ) : null}
      </Map>
    </div>
  )
}

export default FlightsMap

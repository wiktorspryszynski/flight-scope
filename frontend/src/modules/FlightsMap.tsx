import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { MapboxOverlayProps } from '@deck.gl/mapbox'
import Map, { Marker, type MapRef, useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Flight } from '../types/flight'
import airplaneIcon from '../assets/icons/airplane.png'
import FlightInfoCard from './FlightInfoCard'

type FlightsMapProps = {
  maptilerKey: string
  flights: Flight[]
}

type ProjectionType = 'globe' | 'mercator'

const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5
const GLOBE_VISIBILITY_DOT_THRESHOLD = 0.55
const ICON_MAPPING = {
  plane: {
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    anchorX: 32,
    anchorY: 32,
    mask: true,
  },
} as const
const ICON_KEY = 'plane'
const ICON_LAYER_PICKABLE = true
const MAX_MERCATOR_RENDERED_FLIGHTS = 800
const BASE_MERCATOR_RENDERED_FLIGHTS = 220
const RENDERED_FLIGHTS_PER_ZOOM_LEVEL = 140
const MAX_GLOBE_RENDERED_FLIGHTS = 520
const BASE_GLOBE_RENDERED_FLIGHTS = 140
const GLOBE_RENDERED_FLIGHTS_PER_ZOOM_LEVEL = 70
const GLOBE_FOCUS_ZOOM_THRESHOLD = 4.8
const MIN_ICON_SIZE_PX = 12
const MAX_ICON_SIZE_PX = 24
const ICON_DEFAULT_COLOR: [number, number, number, number] = [255, 90, 0, 230]
const ICON_HOVER_COLOR: [number, number, number, number] = [168, 85, 247, 255]

const getFlightPosition = (flight: Flight): [number, number] => [flight.longitude, flight.latitude]
const getFlightIcon = () => ICON_KEY
const normalizeHeading = (heading?: number) => {
  if (!Number.isFinite(heading)) {
    return 0
  }

  return ((heading as number) % 360 + 360) % 360
}

type MapBounds = {
  west: number
  east: number
  south: number
  north: number
}

const toRadians = (value: number) => (value * Math.PI) / 180

const isVisibleOnGlobe = (
  markerLongitude: number,
  markerLatitude: number,
  centerLongitude: number,
  centerLatitude: number,
) => {
  const markerLatRad = toRadians(markerLatitude)
  const markerLonRad = toRadians(markerLongitude)
  const centerLatRad = toRadians(centerLatitude)
  const centerLonRad = toRadians(centerLongitude)

  const markerX = Math.cos(markerLatRad) * Math.cos(markerLonRad)
  const markerY = Math.cos(markerLatRad) * Math.sin(markerLonRad)
  const markerZ = Math.sin(markerLatRad)

  const centerX = Math.cos(centerLatRad) * Math.cos(centerLonRad)
  const centerY = Math.cos(centerLatRad) * Math.sin(centerLonRad)
  const centerZ = Math.sin(centerLatRad)

  const dotProduct = markerX * centerX + markerY * centerY + markerZ * centerZ
  return dotProduct > GLOBE_VISIBILITY_DOT_THRESHOLD
}

const isWithinBounds = (longitude: number, latitude: number, bounds: MapBounds) => {
  if (latitude < bounds.south || latitude > bounds.north) {
    return false
  }

  // Bounds can cross antimeridian: west > east means two joined ranges.
  if (bounds.west <= bounds.east) {
    return longitude >= bounds.west && longitude <= bounds.east
  }

  return longitude >= bounds.west || longitude <= bounds.east
}

const shortestLongitudeDelta = (longitudeA: number, longitudeB: number) => {
  const rawDelta = Math.abs(longitudeA - longitudeB)
  return Math.min(rawDelta, 360 - rawDelta)
}

const distanceScoreToCenter = (flight: Flight, centerLongitude: number, centerLatitude: number) => {
  const latDelta = flight.latitude - centerLatitude
  const lonDelta = shortestLongitudeDelta(flight.longitude, centerLongitude)
  return latDelta * latDelta + lonDelta * lonDelta
}

const mercatorRenderTarget = (zoom: number) => {
  const zoomDelta = Math.max(0, Math.floor(zoom - MERCATOR_ZOOM_THRESHOLD))
  const target = BASE_MERCATOR_RENDERED_FLIGHTS + zoomDelta * RENDERED_FLIGHTS_PER_ZOOM_LEVEL
  return Math.min(MAX_MERCATOR_RENDERED_FLIGHTS, target)
}

const globeRenderTarget = (zoom: number) => {
  const zoomDelta = Math.max(0, Math.floor(zoom))
  const target = BASE_GLOBE_RENDERED_FLIGHTS + zoomDelta * GLOBE_RENDERED_FLIGHTS_PER_ZOOM_LEVEL
  return Math.min(MAX_GLOBE_RENDERED_FLIGHTS, target)
}

const iconSizeForZoom = (zoom: number) => {
  if (zoom <= 4) return MIN_ICON_SIZE_PX
  if (zoom >= 8) return MAX_ICON_SIZE_PX
  const t = (zoom - 4) / 4
  return Math.round(MIN_ICON_SIZE_PX + t * (MAX_ICON_SIZE_PX - MIN_ICON_SIZE_PX))
}

const sameFlightsById = (a: Flight[], b: Flight[]) => {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) {
      return false
    }
  }

  return true
}

const pickEvenlyByStride = <T,>(items: T[], targetCount: number) => {
  if (items.length <= targetCount) {
    return items
  }

  const result: T[] = []
  const step = items.length / targetCount
  let cursor = 0

  for (let i = 0; i < targetCount; i += 1) {
    result.push(items[Math.floor(cursor)])
    cursor += step
  }

  return result
}

const selectEvenlyDistributedFlights = (
  sourceFlights: Flight[],
  targetCount: number,
  centerLongitude: number,
  centerLatitude: number,
  zoom: number,
) => {
  if (sourceFlights.length <= targetCount) {
    return sourceFlights
  }

  const gridColumns = Math.max(6, Math.round(Math.sqrt(targetCount * 2)))
  const gridRows = Math.max(3, Math.round(gridColumns / 2))
  const lonCellSize = 360 / gridColumns
  const latCellSize = 180 / gridRows

  const flightsByCell = new globalThis.Map<string, Flight[]>()

  for (const flight of sourceFlights) {
    const lonIndex = Math.max(0, Math.min(gridColumns - 1, Math.floor((flight.longitude + 180) / lonCellSize)))
    const latIndex = Math.max(0, Math.min(gridRows - 1, Math.floor((flight.latitude + 90) / latCellSize)))
    const cellKey = `${latIndex}:${lonIndex}`
    const cellFlights = flightsByCell.get(cellKey)
    if (cellFlights) {
      cellFlights.push(flight)
    } else {
      flightsByCell.set(cellKey, [flight])
    }
  }

  const orderedCellEntries = [...flightsByCell.entries()]
    .map(([cellKey, flightsInCell]) => ({
      cellKey,
      flights: flightsInCell.sort(
        (flightA, flightB) =>
          distanceScoreToCenter(flightA, centerLongitude, centerLatitude) -
          distanceScoreToCenter(flightB, centerLongitude, centerLatitude),
      ),
    }))
    .sort((a, b) => a.cellKey.localeCompare(b.cellKey))

  const topPerCell = orderedCellEntries.map((entry) => entry.flights[0])

  if (topPerCell.length >= targetCount) {
    if (zoom >= GLOBE_FOCUS_ZOOM_THRESHOLD) {
      return topPerCell
        .sort(
          (flightA, flightB) =>
            distanceScoreToCenter(flightA, centerLongitude, centerLatitude) -
            distanceScoreToCenter(flightB, centerLongitude, centerLatitude),
        )
        .slice(0, targetCount)
    }

    return pickEvenlyByStride(topPerCell, targetCount)
  }

  const selected = [...topPerCell]
  const selectedIds = new Set(selected.map((flight) => flight.id))
  const maxDepth = Math.max(...orderedCellEntries.map((entry) => entry.flights.length))

  for (let depth = 1; depth < maxDepth && selected.length < targetCount; depth += 1) {
    if (zoom >= GLOBE_FOCUS_ZOOM_THRESHOLD) {
      const remaining = orderedCellEntries
        .map((entry) => entry.flights[depth])
        .filter((flight): flight is Flight => Boolean(flight) && !selectedIds.has(flight.id))
        .sort(
          (flightA, flightB) =>
            distanceScoreToCenter(flightA, centerLongitude, centerLatitude) -
            distanceScoreToCenter(flightB, centerLongitude, centerLatitude),
        )

      for (const flight of remaining) {
        if (selected.length >= targetCount) {
          break
        }
        selected.push(flight)
        selectedIds.add(flight.id)
      }
    } else {
      for (const entry of orderedCellEntries) {
        if (selected.length >= targetCount) {
          break
        }
        const candidate = entry.flights[depth]
        if (!candidate || selectedIds.has(candidate.id)) {
          continue
        }
        selected.push(candidate)
        selectedIds.add(candidate.id)
      }
    }
  }

  return selected.slice(0, targetCount)
}

type DeckGLOverlayProps = Omit<MapboxOverlayProps, 'interleaved'>

function DeckGLOverlay(props: DeckGLOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ interleaved: false, ...props }))
  overlay.setProps(props)
  return null
}

const normalizeProjectionType = (projectionType: unknown): ProjectionType =>
  projectionType === 'mercator' ? 'mercator' : 'globe'

function FlightsMap({ maptilerKey, flights }: FlightsMapProps) {
  const [viewState, setViewState] = useState({ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM, bearing: 0 })
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const [projectionType, setProjectionType] = useState<ProjectionType>(
    INITIAL_ZOOM >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe',
  )
  const [renderedMercatorFlights, setRenderedMercatorFlights] = useState<Flight[]>([])
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null)
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null)
  const [globeSamplingAnchor, setGlobeSamplingAnchor] = useState({
    longitude: 20,
    latitude: 50,
    zoomBucket: Math.floor(INITIAL_ZOOM * 2) / 2,
  })
  const mapRef = useRef<MapRef | null>(null)
  const previousZoomRef = useRef(INITIAL_ZOOM)
  const isGlobeProjection = projectionType === 'globe'

  useEffect(() => {
    if (!isGlobeProjection) {
      return
    }

    const zoomBucket = Math.floor(viewState.zoom * 2) / 2
    setGlobeSamplingAnchor((previous) => {
      const zoomBucketChanged = previous.zoomBucket !== zoomBucket
      if (!zoomBucketChanged) {
        return previous
      }

      return {
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoomBucket,
      }
    })
  }, [isGlobeProjection, viewState.latitude, viewState.longitude, viewState.zoom])

  const visibleFlights = useMemo(() => {
    if (!bounds) {
      return flights
    }

    return flights.filter((flight) => isWithinBounds(flight.longitude, flight.latitude, bounds))
  }, [bounds, flights])

  const mercatorFlightsTotal = visibleFlights.length
  const globeSamplePool = useMemo(
    () => selectEvenlyDistributedFlights(
      flights,
      globeRenderTarget(viewState.zoom),
      globeSamplingAnchor.longitude,
      globeSamplingAnchor.latitude,
      viewState.zoom,
    ),
    [flights, globeSamplingAnchor.latitude, globeSamplingAnchor.longitude, viewState.zoom],
  )
  const renderedGlobeFlights = useMemo(
    () =>
      globeSamplePool.filter((flight) =>
        isVisibleOnGlobe(flight.longitude, flight.latitude, viewState.longitude, viewState.latitude),
      ),
    [globeSamplePool, viewState.latitude, viewState.longitude],
  )

  useEffect(() => {
    if (isGlobeProjection) {
      setRenderedMercatorFlights((previous) => (previous.length === 0 ? previous : []))
      previousZoomRef.current = viewState.zoom
      return
    }

    const zoomingIn = viewState.zoom > previousZoomRef.current
    previousZoomRef.current = viewState.zoom

    const orderedCandidates = [...visibleFlights]
      .sort(
        (flightA, flightB) =>
          distanceScoreToCenter(flightA, viewState.longitude, viewState.latitude) -
          distanceScoreToCenter(flightB, viewState.longitude, viewState.latitude),
      )
      .slice(0, MAX_MERCATOR_RENDERED_FLIGHTS)

    const targetCount = mercatorRenderTarget(viewState.zoom)

    setRenderedMercatorFlights((previousFlights) => {
      const candidateById = new globalThis.Map(orderedCandidates.map((flight) => [flight.id, flight]))
      const keptFlights = previousFlights
        .filter((flight) => candidateById.has(flight.id))
        .map((flight) => candidateById.get(flight.id) as Flight)

      if (!zoomingIn && keptFlights.length > 0) {
        const nextFlights = keptFlights.slice(0, targetCount)
        return sameFlightsById(previousFlights, nextFlights) ? previousFlights : nextFlights
      }

      const keptIds = new Set(keptFlights.map((flight) => flight.id))
      const missingFlights = orderedCandidates.filter((flight) => !keptIds.has(flight.id))
      const remainingCapacity = Math.max(0, targetCount - keptFlights.length)
      const newFlights = missingFlights.slice(0, remainingCapacity)

      const nextFlights = keptFlights.concat(newFlights)
      return sameFlightsById(previousFlights, nextFlights) ? previousFlights : nextFlights
    })
  }, [isGlobeProjection, viewState.latitude, viewState.longitude, viewState.zoom, visibleFlights])

  const getFlightAngleMercator = useCallback(
    (flight: Flight) => normalizeHeading(-(flight.heading ?? 0)),
    [],
  )
  const getFlightAngleGlobe = useCallback(
    (flight: Flight) => normalizeHeading((flight.heading ?? 0) - viewState.bearing),
    [viewState.bearing],
  )
  const mercatorIconSize = iconSizeForZoom(viewState.zoom)
  const globeIconSize = iconSizeForZoom(viewState.zoom - 0.5)
  const getFlightColorMercator = useCallback(
    (flight: Flight) => (flight.id === hoveredFlightId ? ICON_HOVER_COLOR : ICON_DEFAULT_COLOR),
    [hoveredFlightId],
  )
  const getFlightSizeMercator = useCallback(
    (flight: Flight) => (flight.id === hoveredFlightId ? mercatorIconSize + 3 : mercatorIconSize),
    [hoveredFlightId, mercatorIconSize],
  )
  const mercatorLayer = useMemo(
    () =>
      new IconLayer<Flight>({
        id: 'flights-icons-mercator',
        data: renderedMercatorFlights,
        pickable: ICON_LAYER_PICKABLE,
        billboard: true,
        iconAtlas: airplaneIcon,
        iconMapping: ICON_MAPPING,
        sizeUnits: 'pixels',
        getIcon: getFlightIcon,
        getSize: getFlightSizeMercator,
        getPosition: getFlightPosition,
        getColor: getFlightColorMercator,
        getAngle: getFlightAngleMercator,
        transitions: {
          getColor: 140,
          getSize: 140,
        },
        onHover: (info) => {
          setHoveredFlightId(info.object ? info.object.id : null)
        },
        onClick: (info) => {
          setHoveredFlightId(null)
          setSelectedFlight(info.object ?? null)
        },
      }),
    [getFlightAngleMercator, getFlightColorMercator, getFlightSizeMercator, renderedMercatorFlights],
  )
  const deckLayers = useMemo(() => [mercatorLayer], [mercatorLayer])

  const syncProjectionWithZoom = (zoom: number) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const currentProjection = normalizeProjectionType(map.getProjection()?.type)
    const nextProjection: ProjectionType = zoom >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe'

    if (currentProjection !== nextProjection) {
      map.setProjection({ type: nextProjection })
      if (nextProjection === 'mercator') {
        map.easeTo({ bearing: 0, pitch: 0, duration: 0 })
      }
    }

    setProjectionType((previous) => (previous === nextProjection ? previous : nextProjection))
  }

  const updateBoundsFromMap = () => {
    const map = mapRef.current?.getMap()
    if (!map) {
      return
    }

    const nextBounds = map.getBounds()
    setBounds({
      west: nextBounds.getWest(),
      east: nextBounds.getEast(),
      south: nextBounds.getSouth(),
      north: nextBounds.getNorth(),
    })
  }

  return (
    <div className="flight-map-wrapper">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM }}
        onLoad={() => {
          syncProjectionWithZoom(INITIAL_ZOOM)
          setProjectionType(normalizeProjectionType(mapRef.current?.getMap().getProjection()?.type))
          updateBoundsFromMap()
        }}
        onMove={(event) => {
          if (hoveredFlightId) {
            setHoveredFlightId(null)
          }
          setViewState((previous) => {
            const next = {
              longitude: event.viewState.longitude,
              latitude: event.viewState.latitude,
              zoom: event.viewState.zoom,
              bearing: event.viewState.bearing,
            }

            const sameLongitude = Math.abs(previous.longitude - next.longitude) < 1e-7
            const sameLatitude = Math.abs(previous.latitude - next.latitude) < 1e-7
            const sameZoom = Math.abs(previous.zoom - next.zoom) < 1e-7
            const sameBearing = Math.abs(previous.bearing - next.bearing) < 1e-7

            return sameLongitude && sameLatitude && sameZoom && sameBearing ? previous : next
          })
        }}
        onMoveEnd={(event) => {
          setHoveredFlightId(null)
          setViewState((previous) => {
            const next = {
              longitude: event.viewState.longitude,
              latitude: event.viewState.latitude,
              zoom: event.viewState.zoom,
              bearing: event.viewState.bearing,
            }

            const sameLongitude = Math.abs(previous.longitude - next.longitude) < 1e-7
            const sameLatitude = Math.abs(previous.latitude - next.latitude) < 1e-7
            const sameZoom = Math.abs(previous.zoom - next.zoom) < 1e-7
            const sameBearing = Math.abs(previous.bearing - next.bearing) < 1e-7

            return sameLongitude && sameLatitude && sameZoom && sameBearing ? previous : next
          })
          syncProjectionWithZoom(event.viewState.zoom)
          updateBoundsFromMap()
        }}
        dragRotate={isGlobeProjection}
        onClick={() => {
          setHoveredFlightId(null)
          setSelectedFlight(null)
        }}
        touchPitch={false}
        pitchWithRotate={false}
        maxPitch={0}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      >
        <div className="flight-counter">
          Flights: {isGlobeProjection ? renderedGlobeFlights.length : renderedMercatorFlights.length}
          {isGlobeProjection ? ` / ${globeSamplePool.length}` : ` / ${mercatorFlightsTotal}`} / {flights.length}
        </div>
        {isGlobeProjection
          ? renderedGlobeFlights.map((flight) => (
              <Marker
                key={`${flight.id}`}
                longitude={flight.longitude}
                latitude={flight.latitude}
                anchor="center"
              >
                <button
                  type="button"
                  className={`flight-marker-button${selectedFlight?.id === flight.id ? ' flight-marker-button--selected' : ''}`}
                  aria-label={`Show details for ${flight.callsign || flight.id}`}
                  onMouseEnter={() => setHoveredFlightId(flight.id)}
                  onMouseLeave={() => setHoveredFlightId(null)}
                  onClick={(event) => {
                    event.stopPropagation()
                    setHoveredFlightId(null)
                    setSelectedFlight(flight)
                  }}
                >
                  <img
                    src={airplaneIcon}
                    alt=""
                    aria-hidden
                    className={`flight-marker-icon${hoveredFlightId === flight.id ? ' flight-marker-icon--hovered' : ''}`}
                    width={globeIconSize}
                    height={globeIconSize}
                    style={{
                      width: `${globeIconSize}px`,
                      height: `${globeIconSize}px`,
                      transform: `rotate(${getFlightAngleGlobe(flight)}deg)`,
                      transformOrigin: '50% 50%',
                    }}
                  />
                </button>
              </Marker>
            ))
          : <DeckGLOverlay layers={deckLayers} />}
        {selectedFlight ? <FlightInfoCard flight={selectedFlight} onClose={() => setSelectedFlight(null)} /> : null}
        {/* <Credits /> */}
      </Map>
    </div>
  )
}

export default FlightsMap

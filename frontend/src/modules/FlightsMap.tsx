import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { MapboxOverlayProps } from '@deck.gl/mapbox'
import Map, { Marker, type MapRef, useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Flight } from '../types/flight'
import airplaneIcon from '../assets/icons/airplane.png'

type FlightsMapProps = {
  maptilerKey: string
  flights: Flight[]
}

type ProjectionType = 'globe' | 'mercator'

const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5
const GLOBE_VISIBILITY_DOT_THRESHOLD = 0.55
const ICON_COLOR: [number, number, number, number] = [255, 90, 0, 230]
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
const ICON_LAYER_PICKABLE = false
const MAX_MERCATOR_RENDERED_FLIGHTS = 800
const BASE_MERCATOR_RENDERED_FLIGHTS = 220
const RENDERED_FLIGHTS_PER_ZOOM_LEVEL = 140
const MAX_GLOBE_RENDERED_FLIGHTS = 300
const MIN_ICON_SIZE_PX = 12
const MAX_ICON_SIZE_PX = 24

const getFlightPosition = (flight: Flight): [number, number] => [flight.longitude, flight.latitude]
const getFlightIcon = () => ICON_KEY
const getFlightColor = () => ICON_COLOR
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

const isSameHemisphere = (
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
  const mapRef = useRef<MapRef | null>(null)
  const previousZoomRef = useRef(INITIAL_ZOOM)
  const isGlobeProjection = projectionType === 'globe'

  const globeFlights = useMemo(
    () =>
      flights.filter((flight) =>
        isSameHemisphere(flight.longitude, flight.latitude, viewState.longitude, viewState.latitude),
      ),
    [flights, viewState.latitude, viewState.longitude],
  )

  const visibleFlights = useMemo(() => {
    if (!bounds) {
      return flights
    }

    return flights.filter((flight) => isWithinBounds(flight.longitude, flight.latitude, bounds))
  }, [bounds, flights])

  const flightsInCurrentView = isGlobeProjection ? globeFlights : visibleFlights
  const mercatorFlightsTotal = visibleFlights.length
  const renderedGlobeFlights = useMemo(
    () =>
      [...globeFlights]
        .sort(
          (flightA, flightB) =>
            distanceScoreToCenter(flightA, viewState.longitude, viewState.latitude) -
            distanceScoreToCenter(flightB, viewState.longitude, viewState.latitude),
        )
        .slice(0, MAX_GLOBE_RENDERED_FLIGHTS),
    [globeFlights, viewState.latitude, viewState.longitude],
  )

  useEffect(() => {
    if (isGlobeProjection) {
      setRenderedMercatorFlights([])
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

  const getFlightAngleMercator = useCallback((flight: Flight) => normalizeHeading(flight.heading), [])
  const getFlightAngleGlobe = useCallback(
    (flight: Flight) => normalizeHeading((flight.heading ?? 0) - viewState.bearing),
    [viewState.bearing],
  )
  const mercatorIconSize = iconSizeForZoom(viewState.zoom)
  const globeIconSize = iconSizeForZoom(viewState.zoom - 0.5)
  const mercatorLayer = useMemo(
    () =>
      new IconLayer<Flight>({
        id: 'flights-icons-mercator',
        data: renderedMercatorFlights,
        pickable: ICON_LAYER_PICKABLE,
        billboard: false,
        iconAtlas: airplaneIcon,
        iconMapping: ICON_MAPPING,
        sizeUnits: 'pixels',
        getIcon: getFlightIcon,
        getSize: mercatorIconSize,
        getPosition: getFlightPosition,
        getColor: getFlightColor,
        getAngle: getFlightAngleMercator,
      }),
    [getFlightAngleMercator, mercatorIconSize, renderedMercatorFlights],
  )
  const deckLayers = useMemo(() => [mercatorLayer], [mercatorLayer])

  const syncProjectionWithZoom = (zoom: number) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const currentProjection = normalizeProjectionType(map.getProjection()?.type)
    const nextProjection: ProjectionType = zoom >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe'

    if (currentProjection !== nextProjection) {
      map.setProjection({ type: nextProjection })
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
        onMoveEnd={(event) => {
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
        dragRotate={true}
        touchPitch={!isGlobeProjection}
        pitchWithRotate={!isGlobeProjection}
        maxPitch={isGlobeProjection ? 0 : 60}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      >
        <div className="flight-counter">
          Flights: {isGlobeProjection ? renderedGlobeFlights.length : renderedMercatorFlights.length}
          {isGlobeProjection ? ` / ${flightsInCurrentView.length}` : ` / ${mercatorFlightsTotal}`} / {flights.length}
        </div>
        {isGlobeProjection
          ? renderedGlobeFlights.map((flight) => (
              <Marker
                key={`${flight.id}`}
                longitude={flight.longitude}
                latitude={flight.latitude}
                anchor="center"
              >
                <img
                  src={airplaneIcon}
                  alt=""
                  aria-hidden
                  width={globeIconSize}
                  height={globeIconSize}
                  style={{
                    width: `${globeIconSize}px`,
                    height: `${globeIconSize}px`,
                    transform: `rotate(${getFlightAngleGlobe(flight)}deg)`,
                    transformOrigin: '50% 50%',
                    filter:
                      'brightness(0) saturate(100%) invert(45%) sepia(92%) saturate(3297%) hue-rotate(359deg) brightness(102%) contrast(105%)',
                  }}
                />
              </Marker>
            ))
          : <DeckGLOverlay layers={deckLayers} />}
        {/* <Credits /> */}
      </Map>
    </div>
  )
}

export default FlightsMap

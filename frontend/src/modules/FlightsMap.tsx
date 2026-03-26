import { useCallback, useMemo, useRef, useState } from 'react'
import Map, { Marker, type MapRef } from 'react-map-gl/maplibre'
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

const normalizeProjectionType = (projectionType: unknown): ProjectionType =>
  projectionType === 'mercator' ? 'mercator' : 'globe'

function FlightsMap({ maptilerKey, flights }: FlightsMapProps) {
  const [viewState, setViewState] = useState({ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM, bearing: 0 })
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const [projectionType, setProjectionType] = useState<ProjectionType>(
    INITIAL_ZOOM >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe',
  )
  const mapRef = useRef<MapRef | null>(null)
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
  const getFlightAngleForView = useCallback(
    (flight: Flight) => normalizeHeading((flight.heading ?? 0) - viewState.bearing),
    [viewState.bearing],
  )

  const syncProjectionWithZoom = (zoom: number) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const currentProjection = normalizeProjectionType(map.getProjection()?.type)
    const nextProjection: ProjectionType = zoom >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe'

    if (currentProjection !== nextProjection) {
      map.setProjection({ type: nextProjection })
    }

    setProjectionType(nextProjection)
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
          setViewState({
            longitude: event.viewState.longitude,
            latitude: event.viewState.latitude,
            zoom: event.viewState.zoom,
            bearing: event.viewState.bearing,
          })
        }}
        onMoveEnd={(event) => {
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
        <div className="flight-counter">Flights: {flightsInCurrentView.length} / {flights.length}</div>
        {flightsInCurrentView.map((flight) => (
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
              width={20}
              height={20}
              style={{
                width: '20px',
                height: '20px',
                transform: `rotate(${getFlightAngleForView(flight)}deg)`,
                transformOrigin: '50% 50%',
                filter:
                  'brightness(0) saturate(100%) invert(45%) sepia(92%) saturate(3297%) hue-rotate(359deg) brightness(102%) contrast(105%)',
              }}
            />
          </Marker>
        ))}
        {/* <Credits /> */}
      </Map>
    </div>
  )
}

export default FlightsMap

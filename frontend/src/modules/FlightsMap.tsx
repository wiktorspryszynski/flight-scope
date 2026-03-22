import { useMemo, useRef, useState } from 'react'
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

const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5
const GLOBE_VISIBILITY_DOT_THRESHOLD = 0.43
const ICON_SIZE_PX = 28
const ICON_COLOR: [number, number, number, number] = [255, 90, 0, 230]
const ICON_MAPPING = {
  plane: {
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    anchorX: 64,
    anchorY: 64,
    mask: true,
  },
} as const
const ICON_KEY = 'plane'
const ICON_LAYER_PICKABLE = true

const getFlightPosition = (flight: Flight): [number, number] => [flight.longitude, flight.latitude]
const getFlightIcon = () => ICON_KEY
const getFlightSize = () => ICON_SIZE_PX
const getFlightColor = () => ICON_COLOR
const getFlightAngle = (flight: Flight) => flight.heading ?? 0

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
  return dotProduct >= GLOBE_VISIBILITY_DOT_THRESHOLD
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

type DeckGLOverlayProps = Omit<MapboxOverlayProps, 'interleaved'>

function DeckGLOverlay(props: DeckGLOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ interleaved: false, ...props }))
  overlay.setProps(props)

  return null
}

function FlightsMap({ maptilerKey, flights }: FlightsMapProps) {
  const [viewState, setViewState] = useState({ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM })
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const mapRef = useRef<MapRef | null>(null)
  const isGlobeProjection = viewState.zoom < MERCATOR_ZOOM_THRESHOLD

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
  const flightsLayer = useMemo(
    () =>
      new IconLayer<Flight>({
        id: 'flights-icons',
        data: visibleFlights,
        pickable: ICON_LAYER_PICKABLE,
        billboard: true,
        iconAtlas: airplaneIcon,
        iconMapping: ICON_MAPPING,
        sizeUnits: 'pixels',
        getIcon: getFlightIcon,
        getSize: getFlightSize,
        getPosition: getFlightPosition,
        getColor: getFlightColor,
        getAngle: getFlightAngle,
      }),
    [visibleFlights],
  )

  const deckLayers = useMemo(() => [flightsLayer], [flightsLayer])

  const syncProjectionWithZoom = (zoom: number) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const currentProjection = map.getProjection()?.type
    const nextProjection = zoom >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe'

    if (currentProjection !== nextProjection) {
      map.setProjection({ type: nextProjection })
    }
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
          updateBoundsFromMap()
        }}
        onMove={(event) => {
          setViewState({
            longitude: event.viewState.longitude,
            latitude: event.viewState.latitude,
            zoom: event.viewState.zoom,
          })
        }}
        onMoveEnd={(event) => {
          syncProjectionWithZoom(event.viewState.zoom)
          updateBoundsFromMap()
        }}
        dragRotate={true}
        touchPitch={true}
        pitchWithRotate={true}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      >
        <div className="flight-counter">Flights: {flightsInCurrentView.length} / {flights.length}</div>
        {isGlobeProjection
          ? globeFlights.map((flight) => (
              <Marker
                key={`${flight.id}-${flight.longitude}-${flight.latitude}`}
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
                    filter:
                      'brightness(0) saturate(100%) invert(45%) sepia(92%) saturate(3297%) hue-rotate(359deg) brightness(102%) contrast(105%)',
                  }}
                />
              </Marker>
            ))
          : <DeckGLOverlay layers={deckLayers} />}
      </Map>
    </div>
  )
}

export default FlightsMap

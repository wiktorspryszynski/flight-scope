import { useMemo, useRef, useState } from 'react'
import Map, { type LayerProps, type MapRef, Source, Layer } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Flight } from '../types/flight'
import type { FeatureCollection, Point } from 'geojson'

type FlightsMapProps = {
  maptilerKey: string
  flights: Flight[]
}

const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5
const GLOBE_VISIBILITY_DOT_THRESHOLD = 0.3

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

function FlightsMap({ maptilerKey, flights }: FlightsMapProps) {
  const layerStyle: LayerProps = {
    id: 'flights',
    type: 'circle',
    paint: {
      'circle-radius': 3,
      'circle-color': '#ff0000',
    },
  }

  const [viewState, setViewState] = useState({ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM })
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const mapRef = useRef<MapRef | null>(null)
  const isGlobeProjection = viewState.zoom < MERCATOR_ZOOM_THRESHOLD

  const visibleFlights = useMemo(() => {
    if (isGlobeProjection) {
      return flights.filter((flight) =>
        isSameHemisphere(flight.longitude, flight.latitude, viewState.longitude, viewState.latitude),
      )
    }

    if (!bounds) {
      return flights
    }

    return flights.filter((flight) => isWithinBounds(flight.longitude, flight.latitude, bounds))
  }, [bounds, flights, isGlobeProjection, viewState.latitude, viewState.longitude])

  const flightsGeoJSON = useMemo<FeatureCollection<Point, { callsign: string; altitude?: number }>>(
    () => ({
      type: 'FeatureCollection',
      features: visibleFlights.map((flight) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [flight.longitude, flight.latitude],
        },
        properties: {
          callsign: flight.callsign,
          altitude: flight.altitude,
        },
      })),
    }),
    [visibleFlights],
  )

  console.log('[FlightsMap] rendering with flights count:', visibleFlights.length)
  console.log(visibleFlights)

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
        <Source id="flights" type="geojson" data={flightsGeoJSON}>
          <Layer {...layerStyle} />
        </Source>
      </Map>
    </div>
  )
}

export default FlightsMap

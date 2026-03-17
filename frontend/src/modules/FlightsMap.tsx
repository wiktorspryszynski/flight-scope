import { useMemo, useRef } from 'react'
import Map, { Marker, type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

type FlightPosition = {
  id: string
  callsign: string
  longitude: number
  latitude: number
}

type FlightsMapProps = {
  maptilerKey: string
  flights: FlightPosition[]
}

const GRID_STEP_DEGREES = 0.5
const MAX_RENDERED_FLIGHTS = 1200
const INITIAL_ZOOM = 3
const MERCATOR_ZOOM_THRESHOLD = 5

const getCellKey = (longitude: number, latitude: number) => {
  const lonBucket = Math.floor((longitude + 180) / GRID_STEP_DEGREES)
  const latBucket = Math.floor((latitude + 90) / GRID_STEP_DEGREES)
  return `${lonBucket}:${latBucket}`
}

function FlightsMap({ maptilerKey, flights }: FlightsMapProps) {
  const mapRef = useRef<MapRef | null>(null)

  const syncProjectionWithZoom = (zoom: number) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const currentProjection = map.getProjection()?.type
    const nextProjection = zoom >= MERCATOR_ZOOM_THRESHOLD ? 'mercator' : 'globe'

    if (currentProjection !== nextProjection) {
      map.setProjection({ type: nextProjection })
    }
  }

  const sampledFlights = useMemo(() => {
    const uniqueByCell = new globalThis.Map<string, FlightPosition>()

    for (const flight of flights) {
      const key = getCellKey(flight.longitude, flight.latitude)

      if (!uniqueByCell.has(key)) {
        uniqueByCell.set(key, flight)
      }
    }

    const reducedFlights = Array.from(uniqueByCell.values())

    if (reducedFlights.length <= MAX_RENDERED_FLIGHTS) {
      return reducedFlights
    }

    const stride = Math.ceil(reducedFlights.length / MAX_RENDERED_FLIGHTS)
    return reducedFlights.filter((_, index) => index % stride === 0)
  }, [flights])

  return (
    <div className="flight-map-wrapper">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 20, latitude: 50, zoom: INITIAL_ZOOM }}
        onLoad={() => syncProjectionWithZoom(INITIAL_ZOOM)}
        onMoveEnd={(event) => syncProjectionWithZoom(event.viewState.zoom)}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      >
        {sampledFlights.map((flight) => (
          <Marker key={flight.id} longitude={flight.longitude} latitude={flight.latitude}>
            <div title={flight.callsign || flight.id} className="flight-marker" />
          </Marker>
        ))}
      </Map>
    </div>
  )
}

export default FlightsMap

import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

type FlightsMapProps = {
  maptilerKey: string
}

function FlightsMap({ maptilerKey }: FlightsMapProps) {
  return (
    <div className="flight-map-wrapper">
      <Map
        initialViewState={{ longitude: 20, latitude: 50, zoom: 3 }}
        style={{ width: '100vw', height: '100vh' }}
        mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${maptilerKey}`}
      />
    </div>
  )
}

export default FlightsMap

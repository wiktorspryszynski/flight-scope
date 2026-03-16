import './App.css'
import { useEffect, useState } from 'react'
import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

function App() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!MAPTILER_KEY) {
      setError('Missing MapTiler API key. Please set VITE_MAPTILER_KEY in your .env file.')
      return
    }

    const loadFlights = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/flights/live`)
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`)
        }

        const data = await res.json()
        console.log(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
      }
    }

    loadFlights()
  }, [])

  return (
    <>
      <h1>Flight Tracker</h1>
      <div className={error ? 'error-div' : 'success-div'}>
        {error && `Error: ${error}`}
      </div>
      {!error ?
        <Map
          initialViewState={{ longitude: 19.94, latitude: 50.06, zoom: 5 }}
          style={{ width: "100%", height: "75vh" }}
          mapStyle={`https://api.maptiler.com/maps/019cf841-2b2e-7f6c-8f95-1542cce14fc4/style.json?key=${MAPTILER_KEY}`}
        />
      : null}
    </> 
  )
}

export default App

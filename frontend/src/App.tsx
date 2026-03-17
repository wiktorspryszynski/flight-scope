import './App.css'
import { useEffect, useState } from 'react'
import FlightsMap from './modules/FlightsMap'
import ErrorStatus from './modules/ErrorStatus'
import type { Flight } from './types/flight'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

function App() {
  const [flights, setFlights] = useState<Flight[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const loadFlightsOnce = async () => {
      const endpointUrl = `${API_BASE_URL}/flights/live`
      console.log('[Flights API] fetching once from:', endpointUrl)
      setError(null)

      try {
        const response = await fetch(endpointUrl, { signal: controller.signal })

        if (!response.ok) {
          console.error('[Flights API] request failed:', response.status, response.statusText)
          setError(`Failed to fetch flights (${response.status} ${response.statusText})`)
          return
        }

        const parsed = await response.json()
        console.log('[Flights API] raw payload:', parsed)

        if (!Array.isArray(parsed)) {
          setError('Flights API returned an invalid payload format.')
          return
        }

        const normalizedFlights: Flight[] = parsed
          .map((item, index) => ({
            id: String(item.icao24 ?? item.id ?? `flight-${index}`),
            callsign: String(item.callsign ?? ''),
            longitude: Number(item.longitude),
            latitude: Number(item.latitude),
          }))
          .filter((flight) => Number.isFinite(flight.longitude) && Number.isFinite(flight.latitude))

        setFlights(normalizedFlights)
        console.log('[Flights API] flights stored:', normalizedFlights.length)

      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log('[Flights API] fetch aborted during cleanup')
          return
        }
        const errorString = `[Flights API] error while fetching flights: ${String(error)}`
        console.error(errorString)
        setError(errorString)
      }
    }

    void loadFlightsOnce()

    return () => {
      controller.abort()
    }
  }, [])

  if (!API_BASE_URL) {
    return <ErrorStatus error="API base URL is missing. Please set VITE_API_BASE_URL in your environment variables." />
  }

  if (!MAPTILER_KEY) {
    return <ErrorStatus error="MapTiler API key is missing. Please set VITE_MAPTILER_KEY in your environment variables." />
  }

  if (error) {
    return <ErrorStatus error={error} />
  }

  return <FlightsMap maptilerKey={MAPTILER_KEY} flights={flights.slice(0, 100)} />
}

export default App

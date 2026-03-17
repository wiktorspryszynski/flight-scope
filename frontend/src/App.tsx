import './App.css'
import { useEffect, useState } from 'react'
import FlightsMap from './modules/FlightsMap'
import ErrorStatus from './modules/ErrorStatus'

type FlightPosition = {
  id: string
  callsign: string
  longitude: number
  latitude: number
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

function App() {
  const [flights, setFlights] = useState<FlightPosition[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isEffectActive = true

    const loadFlightsOnce = async () => {
      const endpointUrl = `${API_BASE_URL}/flights/live`
      console.log('[Flights API] fetching once from:', endpointUrl)
      setError(null)

      try {
        const response = await fetch(endpointUrl)

        if (!response.ok) {
          console.error('[Flights API] request failed:', response.status, response.statusText)
          setError(`Failed to fetch flights (${response.status} ${response.statusText})`)
          return
        }

        const parsed = await response.json()
        console.log('[Flights API] raw payload:', parsed)

        if (Array.isArray(parsed)) {
          const normalizedFlights: FlightPosition[] = parsed
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((item, index) => {
              const longitude = Number(item.longitude)
              const latitude = Number(item.latitude)

              return {
                id: String(item.icao24 ?? `flight-${index}`),
                callsign: String(item.callsign ?? ''),
                longitude,
                latitude,
              }
            })
            .filter(
              (flight) =>
                Number.isFinite(flight.longitude) &&
                Number.isFinite(flight.latitude) &&
                Math.abs(flight.longitude) <= 180 &&
                Math.abs(flight.latitude) <= 90,
            )

          if (!isEffectActive) {
            return
          }

          setFlights(normalizedFlights)
          console.log('[Flights API] flights count:', normalizedFlights.length)
          console.table(normalizedFlights.slice(0, 10))
        } else {
          setError('Unexpected flights API response format')
        }
      } catch (error) {
        const errorString = `[Flights API] error while fetching flights: ${String(error)}`
        console.error(errorString)
        setError(errorString)
      }
    }

    void loadFlightsOnce()

    return () => {
      isEffectActive = false
    }
  }, [])

  useEffect(() => {
    console.log('[Flights API] state updated, flights stored locally:', flights.length)
  }, [flights])

  if (!MAPTILER_KEY) {
    setError("MapTiler API key is missing. Please set VITE_MAPTILER_KEY in your environment variables.")
  }

  if (error) {
    return <ErrorStatus error={error} />
  }

  return <FlightsMap maptilerKey={MAPTILER_KEY} flights={flights} />
}

export default App

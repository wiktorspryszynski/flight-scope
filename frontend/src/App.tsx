import './App.css'
import { useEffect, useState } from 'react'
import FlightsMap from './modules/FlightsMap'
import ErrorStatus from './modules/ErrorStatus'
import LoadingStatus from './modules/LoadingStatus'
import type { Flight } from './types/flight'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

const SSE_INTERVAL_MS = 60_000

function normalizeFlights(raw: unknown[]): Flight[] {
  return raw
    .map((item, index) => {
      const it = item as Record<string, unknown>
      return {
        id: String(it.icao24 ?? it.id ?? `flight-${index}`),
        callsign: String(it.callsign ?? ''),
        longitude: Number(it.longitude),
        latitude: Number(it.latitude),
        heading: it.heading !== undefined ? Number(it.heading) : undefined,
        altitude: it.altitude !== undefined ? Number(it.altitude) : undefined,
        velocity: it.velocity !== undefined ? Number(it.velocity) : undefined,
      }
    })
    .filter((f) => Number.isFinite(f.longitude) && Number.isFinite(f.latitude))
}

function App() {
  const [prevFlights, setPrevFlights] = useState<Flight[]>([])
  const [nextFlights, setNextFlights] = useState<Flight[]>([])
  const [animationStartTime, setAnimationStartTime] = useState(0)
  const [animationDuration, setAnimationDuration] = useState(SSE_INTERVAL_MS)
  const [isLoading, setIsLoading] = useState(true)
  const [sseError, setSseError] = useState<string | null>(null)

  useEffect(() => {
    const sseUrl = `${API_BASE_URL}/api/sse/flights`
    const es = new EventSource(sseUrl)
    let hasReceivedData = false

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { prev: unknown[]; next: unknown[] }
        if (!msg.prev || !msg.next) return
        const prev = normalizeFlights(msg.prev)
        const next = normalizeFlights(msg.next)
        setPrevFlights(prev)
        setNextFlights(next)
        setAnimationStartTime(Date.now())
        setAnimationDuration(SSE_INTERVAL_MS)
        hasReceivedData = true
        setIsLoading(false)
      } catch {
        setSseError('Received malformed data from server.')
      }
    }

    es.onerror = () => {
      if (!hasReceivedData) setSseError('Could not connect to the server.')
    }

    return () => {
      es.close()
    }
  }, [])

  if (!API_BASE_URL) return <ErrorStatus error="API base URL is missing. Please set VITE_API_BASE_URL." />
  if (!MAPTILER_KEY) return <ErrorStatus error="MapTiler key is missing. Please set VITE_MAPTILER_KEY." />
  if (sseError) return <ErrorStatus error={sseError} />

  return (
    <div className="map-shell">
      <FlightsMap
        maptilerKey={MAPTILER_KEY}
        prevFlights={prevFlights}
        nextFlights={nextFlights}
        animationStartTime={animationStartTime}
        animationDuration={animationDuration}
      />
      {isLoading ? <LoadingStatus overlay /> : null}
    </div>
  )
}

export default App

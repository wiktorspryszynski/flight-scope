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
  const [isStale, setIsStale] = useState(false)
  const [sseError, setSseError] = useState<string | null>(null)

  useEffect(() => {
    const sseUrl = `${API_BASE_URL}/api/sse/flights`
    const es = new EventSource(sseUrl)
    let hasReceivedData = false

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { prev: unknown[]; next: unknown[]; stale?: boolean; noData?: boolean }
        if (!msg.prev || !msg.next) return
        setIsStale(!!msg.stale)
        const prev = normalizeFlights(msg.prev)
        const next = normalizeFlights(msg.next)
        const dataType = msg.noData ? 'none' : msg.stale ? 'stale' : 'live'
        console.log(`[SSE] ${dataType} | prev=${prev.length} next=${next.length}`)
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
      console.warn('[SSE] connection error', { hasReceivedData })
      if (!hasReceivedData) setSseError('Could not connect to the server.')
    }

    const loadingTimeout = setTimeout(() => {
      if (!hasReceivedData) {
        console.warn('[SSE] loading timeout — no data received within 20 s')
        setIsLoading(false)
      }
    }, 20_000)

    return () => {
      es.close()
      clearTimeout(loadingTimeout)
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
      {!isLoading && isStale ? (
        <div className="stale-banner">Live feed unavailable — showing last known data</div>
      ) : null}
    </div>
  )
}

export default App

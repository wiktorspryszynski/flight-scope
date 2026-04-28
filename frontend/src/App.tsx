import './App.css'
import { useEffect, useState } from 'react'
import FlightsMap from './modules/FlightsMap'
import ErrorStatus from './modules/ErrorStatus'
import LoadingStatus from './modules/LoadingStatus'
import type { Flight } from './types/flight'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

const WS_INTERVAL_MS = 60_000

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
  const [animationDuration, setAnimationDuration] = useState(WS_INTERVAL_MS)
  const [isLoading, setIsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)

  useEffect(() => {
    const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/api/ws/flights`
    const ws = new WebSocket(wsUrl)
    let hasReceivedData = false

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { prev: unknown[]; next: unknown[] }
        if (!msg.prev || !msg.next) return
        const prev = normalizeFlights(msg.prev)
        const next = normalizeFlights(msg.next)
        setPrevFlights(prev)
        setNextFlights(next)
        setAnimationStartTime(Date.now())
        setAnimationDuration(WS_INTERVAL_MS)
        hasReceivedData = true
        setIsLoading(false)
      } catch {
        setWsError('Received malformed data from server.')
      }
    }

    ws.onerror = () => setWsError('Could not connect to the server.')
    ws.onclose = () => {
      if (!hasReceivedData) setWsError('Connection closed before receiving data.')
    }

    return () => {
      ws.close()
    }
  }, [])

  if (!API_BASE_URL) return <ErrorStatus error="API base URL is missing. Please set VITE_API_BASE_URL." />
  if (!MAPTILER_KEY) return <ErrorStatus error="MapTiler key is missing. Please set VITE_MAPTILER_KEY." />
  if (wsError) return <ErrorStatus error={wsError} />

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

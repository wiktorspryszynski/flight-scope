import './App.css'
import { useEffect, useRef, useState } from 'react'
import FlightsMap from './modules/FlightsMap'
import ErrorStatus from './modules/ErrorStatus'
import LoadingStatus from './modules/LoadingStatus'
import type { Flight } from './types/flight'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

const WS_INTERVAL_MS = 12_000
const INITIAL_ANIMATION_DURATION = 2_000

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

async function fetchFlights(signal?: AbortSignal): Promise<Flight[]> {
  const res = await fetch(`${API_BASE_URL}/flights/live`, { signal })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const raw = await res.json()
  if (!Array.isArray(raw)) throw new Error('Invalid payload format')
  return normalizeFlights(raw)
}

function App() {
  const [prevFlights, setPrevFlights] = useState<Flight[]>([])
  const [nextFlights, setNextFlights] = useState<Flight[]>([])
  const [animationStartTime, setAnimationStartTime] = useState(0)
  const [animationDuration, setAnimationDuration] = useState(INITIAL_ANIMATION_DURATION)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout>

    const init = async () => {
      // Fetch 1 — populates Redis with initial positions; heading falls back to true_track
      let first: Flight[]
      try {
        first = await fetchFlights(controller.signal)
        console.log('[Flights] fetch 1 complete:', first.length, 'flights')
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError(`Failed to fetch flights: ${String(err)}`)
        setIsLoading(false)
        return
      }

      // Fetch 2 (2 s later) — Redis now has prev positions, computed bearing available
      timeoutId = setTimeout(async () => {
        let second: Flight[]
        try {
          second = await fetchFlights(controller.signal)
          console.log('[Flights] fetch 2 complete:', second.length, 'flights')
        } catch (err) {
          if ((err as Error).name === 'AbortError') return
          setError(`Failed to fetch flights: ${String(err)}`)
          setIsLoading(false)
          return
        }

        if (second.length === 0 && first.length === 0) {
          setError('No flights returned by the backend. Check OpenSky credentials or API availability.')
          setIsLoading(false)
          return
        }

        // Start animating between the two snapshots, hide loading overlay
        setPrevFlights(first)
        setNextFlights(second)
        setAnimationStartTime(Date.now())
        setAnimationDuration(INITIAL_ANIMATION_DURATION)
        setIsLoading(false)

        // Open WebSocket — each message advances the animation window
        const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/ws/flights?interval_ms=${WS_INTERVAL_MS}`
        console.log('[WS] connecting to', wsUrl)
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onmessage = (event) => {
          try {
            const raw = JSON.parse(event.data as string)
            if (!Array.isArray(raw)) return
            const incoming = normalizeFlights(raw)
            setNextFlights((current) => {
              setPrevFlights(current)
              return incoming
            })
            setAnimationStartTime(Date.now())
            setAnimationDuration(WS_INTERVAL_MS)
          } catch {
            // malformed frame — ignore
          }
        }

        ws.onerror = () => console.warn('[WS] connection error')
        ws.onclose = () => console.log('[WS] closed')
      }, INITIAL_ANIMATION_DURATION)
    }

    void init()

    return () => {
      controller.abort()
      clearTimeout(timeoutId)
      wsRef.current?.close()
    }
  }, [])

  if (!API_BASE_URL) return <ErrorStatus error="API base URL is missing. Please set VITE_API_BASE_URL." />
  if (!MAPTILER_KEY) return <ErrorStatus error="MapTiler key is missing. Please set VITE_MAPTILER_KEY." />
  if (error) return <ErrorStatus error={error} />

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

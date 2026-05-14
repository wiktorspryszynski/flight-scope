import './App.css'
import { useEffect, useRef, useState } from 'react'
import FlightsMap from './modules/FlightsMap'
import ErrorStatus from './modules/ErrorStatus'
import LoadingStatus from './modules/LoadingStatus'
import HistoryPanel from './modules/HistoryPanel'
import type { Flight } from './types/flight'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

const SSE_INTERVAL_MS = (Number(import.meta.env.VITE_FLIGHT_FETCH_INTERVAL_SECONDS) || 120) * 1000
const SSE_LOADING_TIMEOUT_MS = 15_000

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

type HistoryInfo = { snapshot_time: string; is_downsampled: boolean }

function App() {
  const [prevFlights, setPrevFlights] = useState<Flight[]>([])
  const [nextFlights, setNextFlights] = useState<Flight[]>([])
  const [animationStartTime, setAnimationStartTime] = useState(0)
  const [animationDuration, setAnimationDuration] = useState(SSE_INTERVAL_MS)
  const [isLoading, setIsLoading] = useState(true)
  const [isStale, setIsStale] = useState(false)
  const [sseError, setSseError] = useState<string | null>(null)

  const [historyTime, setHistoryTime] = useState<number | null>(null)
  const [historyInfo, setHistoryInfo] = useState<HistoryInfo | null>(null)
  const [dataRange, setDataRange] = useState<{ oldestMs: number; newestMs: number } | null>(null)
  const historyAbortRef = useRef<AbortController | null>(null)
  const historyTimeRef = useRef<number | null>(null)

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/stats`)
      .then((r) => r.json())
      .then((data: { oldest_snapshot: string | null; newest_snapshot: string | null }) => {
        if (data.oldest_snapshot && data.newest_snapshot) {
          setDataRange({
            oldestMs: new Date(data.oldest_snapshot).getTime(),
            newestMs: new Date(data.newest_snapshot).getTime(),
          })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    historyTimeRef.current = historyTime
    if (historyTime === null) return
    if (historyAbortRef.current) historyAbortRef.current.abort()
    const ac = new AbortController()
    historyAbortRef.current = ac
    fetch(`${API_BASE_URL}/api/flights/at?t=${historyTime / 1000}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data: { flights: unknown[]; snapshot_time: string; is_downsampled: boolean }) => {
        const flights = normalizeFlights(data.flights)
        setPrevFlights(flights)
        setNextFlights(flights)
        setAnimationStartTime(Date.now())
        setHistoryInfo({ snapshot_time: data.snapshot_time, is_downsampled: data.is_downsampled })
      })
      .catch((e) => { if (e.name !== 'AbortError') console.warn('[history]', e) })
  }, [historyTime])

  useEffect(() => {
    const sseUrl = `${API_BASE_URL}/api/sse/flights`
    const es = new EventSource(sseUrl)
    let hasReceivedData = false

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { prev: unknown[]; next: unknown[]; stale?: boolean; noData?: boolean }
        if (!msg.prev || !msg.next) return
        // Don't overwrite history view with live data
        if (historyTimeRef.current !== null) return
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

    const loadingTimeout = setTimeout(async () => {
      if (hasReceivedData) return
      console.warn('[SSE] loading timeout — no data received within 20 s, fetching snapshot')
      try {
        const res = await fetch(`${API_BASE_URL}/api/flights/live`)
        const raw: unknown[] = await res.json()
        const flights = normalizeFlights(raw)
        console.log(`[SSE] snapshot fallback | flights=${flights.length}`)
        setPrevFlights(flights)
        setNextFlights(flights)
        setAnimationStartTime(Date.now())
        setIsStale(true)
      } catch {
        console.warn('[SSE] snapshot fallback failed')
      }
      setIsLoading(false)
    }, SSE_LOADING_TIMEOUT_MS)

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
      {!isLoading && isStale && historyTime === null ? (
        <div className="stale-banner">Live feed unavailable - showing last known data</div>
      ) : null}
      {historyTime !== null && (
        <div className="history-banner">HISTORY MODE</div>
      )}
      {dataRange && (
        <HistoryPanel
          oldestMs={dataRange.oldestMs}
          newestMs={dataRange.newestMs}
          historyTime={historyTime}
          resolvedTime={historyTime !== null ? (historyInfo?.snapshot_time ?? null) : null}
          isDownsampled={historyTime !== null ? (historyInfo?.is_downsampled ?? false) : false}
          onTimeSelect={setHistoryTime}
        />
      )}
    </div>
  )
}

export default App

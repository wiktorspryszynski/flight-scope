import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

type DBStats = {
  snapshot_count: number
  position_count: number
  db_size_bytes: number
  db_size_pretty: string
  positions_table_size_pretty: string
  oldest_snapshot: string | null
  newest_snapshot: string | null
  snapshots_last_24h: number
  rate_limit_hits_24h: number
}

const FETCH_INTERVAL_SECONDS = Number(import.meta.env.VITE_FLIGHT_FETCH_INTERVAL_SECONDS) || 120
const EXPECTED_SNAPSHOTS_24H = Math.round(86400 / FETCH_INTERVAL_SECONDS)

function healthLabel(actual: number, expected: number): { color: string; label: string } {
  const ratio = actual / expected
  if (ratio >= 0.8) return { color: '#22c55e', label: 'Healthy' }
  if (ratio >= 0.4) return { color: '#eab308', label: 'Degraded' }
  return { color: '#ef4444', label: 'Critical' }
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function DBDashboard() {
  const [stats, setStats] = useState<DBStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const load = () => {
    fetch(`${API_BASE_URL}/api/stats`)
      .then((r) => r.json())
      .then((data: DBStats) => {
        setError(null)
        setStats(data)
        setLastFetched(new Date())
      })
      .catch(() => setError('Failed to fetch stats. Is the backend running?'))
  }

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const health = stats ? healthLabel(stats.snapshots_last_24h, EXPECTED_SNAPSHOTS_24H) : null

  return (
    <div className="db-dashboard">
      <header className="db-dashboard__header">
        <div>
          <p className="db-dashboard__eyebrow">flight-scope</p>
          <h1 className="db-dashboard__title">Database Monitor</h1>
        </div>
        <button type="button" className="db-dashboard__refresh" onClick={load}>
          ↺ Refresh
        </button>
      </header>

      {error && <p className="db-dashboard__error">{error}</p>}

      {stats && (
        <>
          <div className="db-dashboard__status-bar">
            <span className="db-dashboard__status-dot" style={{ background: health?.color }} />
            <span className="db-dashboard__status-label" style={{ color: health?.color }}>{health?.label}</span>
            <span className="db-dashboard__status-sub">
              {fmt(stats.snapshots_last_24h)} / {fmt(EXPECTED_SNAPSHOTS_24H)} snapshots in last 24 h
            </span>
          </div>

          <div className="db-dashboard__grid">
            <div className="db-dashboard__card">
              <p className="db-dashboard__card-label">Snapshots</p>
              <p className="db-dashboard__card-value">{fmt(stats.snapshot_count)}</p>
            </div>
            <div className="db-dashboard__card">
              <p className="db-dashboard__card-label">Position rows</p>
              <p className="db-dashboard__card-value">{fmt(stats.position_count)}</p>
            </div>
            <div className="db-dashboard__card">
              <p className="db-dashboard__card-label">DB size</p>
              <p className="db-dashboard__card-value">{stats.db_size_pretty}</p>
              <p className="db-dashboard__card-sub">{fmtBytes(stats.db_size_bytes)}</p>
            </div>
            <div className="db-dashboard__card">
              <p className="db-dashboard__card-label">Positions table</p>
              <p className="db-dashboard__card-value">{stats.positions_table_size_pretty}</p>
            </div>
            <div className="db-dashboard__card" style={stats.rate_limit_hits_24h > 0 ? { borderColor: '#eab308' } : undefined}>
              <p className="db-dashboard__card-label">Rate limit hits (24 h)</p>
              <p className="db-dashboard__card-value" style={{ color: stats.rate_limit_hits_24h > 0 ? '#eab308' : '#22c55e' }}>
                {stats.rate_limit_hits_24h}
              </p>
            </div>
            <div className="db-dashboard__card db-dashboard__card--wide">
              <p className="db-dashboard__card-label">Data range</p>
              <p className="db-dashboard__card-value db-dashboard__card-value--sm">
                {fmtDate(stats.oldest_snapshot)}
              </p>
              <p className="db-dashboard__card-sub">→ {fmtDate(stats.newest_snapshot)}</p>
            </div>
          </div>
        </>
      )}

      {lastFetched && (
        <p className="db-dashboard__footer">Last fetched: {lastFetched.toLocaleTimeString()}</p>
      )}
    </div>
  )
}

export default DBDashboard

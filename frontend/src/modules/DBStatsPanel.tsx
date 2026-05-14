import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

type DBStats = {
  snapshot_count: number
  position_count: number
  db_size_pretty: string
  positions_table_size_pretty: string
  oldest_snapshot: string | null
  newest_snapshot: string | null
  snapshots_last_24h: number
  rate_limit_hits_24h: number
}

const FETCH_INTERVAL_SECONDS = Number(import.meta.env.VITE_FLIGHT_FETCH_INTERVAL_SECONDS) || 120
const EXPECTED_SNAPSHOTS_24H = Math.round(86400 / FETCH_INTERVAL_SECONDS)

function healthDot(actual: number, expected: number): string {
  const ratio = actual / expected
  if (ratio >= 0.8) return '#22c55e'
  if (ratio >= 0.4) return '#eab308'
  return '#ef4444'
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function DBStatsPanel() {
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState<DBStats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open || stats || error) return
    fetch(`${API_BASE_URL}/api/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setError(true))
  }, [open, stats, error])

  const dotColor = stats ? healthDot(stats.snapshots_last_24h, EXPECTED_SNAPSHOTS_24H) : '#6b7280'
  const oldestDate = stats?.oldest_snapshot ? new Date(stats.oldest_snapshot).toLocaleDateString() : null
  const newestDate = stats?.newest_snapshot ? new Date(stats.newest_snapshot).toLocaleDateString() : null

  return (
    <div className="db-stats-panel">
      <button type="button" className="db-stats-panel__toggle" onClick={() => setOpen((o) => !o)}>
        <span className="db-stats-panel__dot" style={{ background: dotColor }} />
        DB Stats
        <span className="db-stats-panel__chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="db-stats-panel__body">
          {error && <p className="db-stats-panel__err">Failed to load.</p>}
          {!error && !stats && <p className="db-stats-panel__loading">Loading…</p>}
          {stats && (
            <dl className="db-stats-panel__list">
              <div className="db-stats-panel__row">
                <dt>Snapshots</dt>
                <dd>{fmt(stats.snapshot_count)}</dd>
              </div>
              <div className="db-stats-panel__row">
                <dt>Positions</dt>
                <dd>{fmt(stats.position_count)}</dd>
              </div>
              <div className="db-stats-panel__row">
                <dt>DB size</dt>
                <dd>{stats.db_size_pretty}</dd>
              </div>
              <div className="db-stats-panel__row">
                <dt>Table size</dt>
                <dd>{stats.positions_table_size_pretty}</dd>
              </div>
              <div className="db-stats-panel__row">
                <dt>Last 24 h</dt>
                <dd style={{ color: healthDot(stats.snapshots_last_24h, EXPECTED_SNAPSHOTS_24H) }}>
                  {fmt(stats.snapshots_last_24h)} / {fmt(EXPECTED_SNAPSHOTS_24H)}
                </dd>
              </div>
              <div className="db-stats-panel__row">
                <dt>Rate limits (24 h)</dt>
                <dd style={{ color: stats.rate_limit_hits_24h > 0 ? '#eab308' : '#22c55e' }}>
                  {stats.rate_limit_hits_24h}
                </dd>
              </div>
              {oldestDate && (
                <div className="db-stats-panel__row">
                  <dt>Data range</dt>
                  <dd>{oldestDate}{newestDate && newestDate !== oldestDate ? ` – ${newestDate}` : ''}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}

export default DBStatsPanel

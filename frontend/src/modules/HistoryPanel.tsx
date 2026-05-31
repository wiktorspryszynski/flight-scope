import { useState, useMemo } from 'react'

interface Props {
  oldestMs: number
  newestMs: number
  historyTime: number | null
  resolvedTime: string | null
  isDownsampled: boolean
  onTimeSelect: (t: number | null) => void
  onOpenChange?: (open: boolean) => void
}

function startOfDayOffset(daysAgo: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.getTime()
}

function fmtResolved(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

type PresetDef = { label: string; getMs: () => number }

const PRESET_DEFS: PresetDef[] = [
  { label: '1h ago',    getMs: () => Date.now() - 3_600_000 },
  { label: '6h ago',    getMs: () => Date.now() - 6 * 3_600_000 },
  { label: '12h ago',   getMs: () => Date.now() - 12 * 3_600_000 },
  { label: 'Yesterday', getMs: () => startOfDayOffset(1) + 12 * 3_600_000 },
  { label: '2d ago',    getMs: () => startOfDayOffset(2) + 12 * 3_600_000 },
  { label: '3d ago',    getMs: () => startOfDayOffset(3) + 12 * 3_600_000 },
]

function buildDayOptions(oldestMs: number, newestMs: number): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const oldest = new Date(oldestMs)
  oldest.setHours(0, 0, 0, 0)
  const cursor = new Date(newestMs)
  cursor.setHours(0, 0, 0, 0)

  while (cursor >= oldest) {
    const diff = Math.round((today.getTime() - cursor.getTime()) / 86_400_000)
    const label =
      diff === 0 ? 'Today' :
      diff === 1 ? 'Yesterday' :
      cursor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    options.push({ label, value: cursor.toISOString().slice(0, 10) })
    cursor.setDate(cursor.getDate() - 1)
  }
  return options
}

function HistoryPanel({ oldestMs, newestMs, historyTime, resolvedTime, isDownsampled, onTimeSelect, onOpenChange }: Props) {
  const [open, setOpen] = useState(false)
  const [activePreset, setActivePreset] = useState<string | null>(null)

  const now = new Date()
  const dayOptions = useMemo(() => buildDayOptions(oldestMs, newestMs), [oldestMs, newestMs])
  const [selDate, setSelDate] = useState(dayOptions[0]?.value ?? now.toISOString().slice(0, 10))
  const [selHour, setSelHour] = useState(now.getHours())
  const [selMinute, setSelMinute] = useState(MINUTES[Math.floor(now.getMinutes() / 5)])

  const visiblePresets = PRESET_DEFS.filter(p => p.getMs() >= oldestMs)

  function handlePreset(def: PresetDef) {
    setActivePreset(def.label)
    onTimeSelect(Math.min(Math.max(def.getMs(), oldestMs), newestMs))
  }

  function applyCustom(date: string, hour: number, minute: number) {
    setActivePreset(null)
    const [y, m, d] = date.split('-').map(Number)
    const ts = new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
    onTimeSelect(Math.min(Math.max(ts, oldestMs), newestMs))
  }

  function handleDateChange(v: string) {
    setSelDate(v)
    applyCustom(v, selHour, selMinute)
  }
  function handleHourChange(v: number) {
    setSelHour(v)
    applyCustom(selDate, v, selMinute)
  }
  function handleMinuteChange(v: number) {
    setSelMinute(v)
    applyCustom(selDate, selHour, v)
  }

  function goLive() {
    setActivePreset(null)
    onTimeSelect(null)
  }

  const isLive = historyTime === null

  function toggleOpen() {
    setOpen((o) => {
      const next = !o
      onOpenChange?.(next)
      return next
    })
  }

  return (
    <div className={`history-panel${open ? ' history-panel--open' : ''}`}>
      <button
        type="button"
        className="history-panel__tab"
        onClick={toggleOpen}
        title={open ? 'Close history panel' : 'Open history panel'}
      >
        {open ? '▶' : '◀'}
      </button>

      <div className="history-panel__body">
        <p className="history-panel__section-label">Quick jump</p>

        <div className="history-panel__presets">
          {visiblePresets.map(def => (
            <button
              key={def.label}
              type="button"
              className={`history-panel__preset${activePreset === def.label ? ' history-panel__preset--active' : ''}`}
              onClick={() => handlePreset(def)}
            >
              {def.label}
            </button>
          ))}
        </div>

        <div className="history-panel__divider" />

        <p className="history-panel__section-label">Custom time</p>

        <div className="history-panel__selects">
          <label className="history-panel__select-group">
            <span>Date</span>
            <select value={selDate} onChange={e => handleDateChange(e.target.value)}>
              {dayOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="history-panel__select-group">
            <span>Hour</span>
            <select value={selHour} onChange={e => handleHourChange(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
              ))}
            </select>
          </label>

          <label className="history-panel__select-group">
            <span>Minute</span>
            <select value={selMinute} onChange={e => handleMinuteChange(Number(e.target.value))}>
              {MINUTES.map(m => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </label>
        </div>

        {resolvedTime && !isLive && (
          <div className="history-panel__resolved">
            <span className="history-panel__resolved-label">Snapshot</span>
            <span>{fmtResolved(resolvedTime)}</span>
            {isDownsampled && <span className="history-panel__downsampled">5-min resolution</span>}
          </div>
        )}

        <div className="history-panel__divider" />

        <button
          type="button"
          className={`history-panel__live-btn${isLive ? ' history-panel__live-btn--active' : ''}`}
          onClick={goLive}
        >
          ● Back to Live
        </button>
      </div>
    </div>
  )
}

export default HistoryPanel

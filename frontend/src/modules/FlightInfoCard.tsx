import { useEffect, useState } from 'react'
import type { Flight } from '../types/flight'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

type FlightInfoCardProps = {
  flight: Flight
  isSpectating: boolean
  onClose: () => void
  onSpectate: (id: string) => void
}

type AircraftInfo = {
  registration: string | null
  manufacturer: string | null
  model: string | null
  typecode: string | null
  operator: string | null
  built: number | null
}

const formatNumber = (value?: number, fractionDigits = 2) =>
  Number.isFinite(value) ? (value as number).toFixed(fractionDigits) : undefined

function FlightInfoCard({ flight, isSpectating, onClose, onSpectate }: FlightInfoCardProps) {
  const [info, setInfo] = useState<AircraftInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)

  useEffect(() => {
    setInfo(null)
    setInfoLoading(true)
    fetch(`${API_BASE_URL}/api/flights/${flight.id}/info`)
      .then((r) => r.json())
      .then((data: AircraftInfo) => {
        setInfo(data)
        setInfoLoading(false)
      })
      .catch(() => setInfoLoading(false))
  }, [flight.id])

  const hasMetadata = info && (info.registration || info.manufacturer || info.model || info.operator || info.built)

  return (
    <aside className="flight-info-card" role="dialog" aria-label="Flight details">
      <div className="flight-info-card__header">
        <div>
          <p className="flight-info-card__label">Selected Flight</p>
          <h3 className="flight-info-card__title">{flight.callsign || 'Unknown callsign'}</h3>
        </div>
        <button type="button" className="flight-info-card__close" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>

      <dl className="flight-info-card__list">
        <div className="flight-info-card__row">
          <dt>ICAO24</dt>
          <dd>{flight.id}</dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Latitude</dt>
          <dd>{formatNumber(flight.latitude, 4)}</dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Longitude</dt>
          <dd>{formatNumber(flight.longitude, 4)}</dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Heading</dt>
          <dd>
            {Number.isFinite(flight.heading)
              ? <>
                  <span>{formatNumber(flight.heading, 1)}°</span>{' '}
                  <span
                    className="flight-info-card__heading-arrow"
                    title="Heading direction"
                    style={{ display: 'inline-block', transform: `rotate(${flight.heading}deg)`, transition: 'transform 0.2s' }}
                  >
                    ↑
                  </span>
                </>
              : 'N/A'}
          </dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Altitude</dt>
          <dd>{Number.isFinite(flight.altitude) ? <>{formatNumber(flight.altitude, 0)} m</> : 'N/A'}</dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Velocity</dt>
          <dd>{Number.isFinite(flight.velocity) ? <>{formatNumber(flight.velocity, 0)} m/s</> : 'N/A'}</dd>
        </div>

        {infoLoading ? (
          <div className="flight-info-card__meta-loading">
            <span className="flight-info-card__skeleton" style={{ width: '60%' }} />
            <span className="flight-info-card__skeleton" style={{ width: '80%' }} />
          </div>
        ) : hasMetadata ? (
          <>
            {info?.registration && (
              <div className="flight-info-card__row flight-info-card__row--divider">
                <dt>Registration</dt>
                <dd>{info.registration}</dd>
              </div>
            )}
            {info?.manufacturer && (
              <div className="flight-info-card__row">
                <dt>Manufacturer</dt>
                <dd>{info.manufacturer}</dd>
              </div>
            )}
            {info?.model && (
              <div className="flight-info-card__row">
                <dt>Model</dt>
                <dd>{info.model}</dd>
              </div>
            )}
            {info?.typecode && (
              <div className="flight-info-card__row">
                <dt>Type</dt>
                <dd>{info.typecode}</dd>
              </div>
            )}
            {info?.operator && (
              <div className="flight-info-card__row">
                <dt>Operator</dt>
                <dd>{info.operator}</dd>
              </div>
            )}
            {info?.built && (
              <div className="flight-info-card__row">
                <dt>Built</dt>
                <dd>{info.built}</dd>
              </div>
            )}
          </>
        ) : null}
      </dl>

      <button
        type="button"
        className={`flight-info-card__spectate${isSpectating ? ' flight-info-card__spectate--active' : ''}`}
        onClick={() => onSpectate(flight.id)}
      >
        {isSpectating ? '✕ Stop spectating' : '◎ Spectate'}
      </button>
    </aside>
  )
}

export default FlightInfoCard

import type { Flight } from '../types/flight'

type FlightInfoCardProps = {
  flight: Flight
  onClose: () => void
}

const formatNumber = (value?: number, fractionDigits = 2) =>
  Number.isFinite(value) ? (value as number).toFixed(fractionDigits) : undefined

function FlightInfoCard({ flight, onClose }: FlightInfoCardProps) {
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
                    style={{
                      display: 'inline-block',
                      transform: `rotate(${flight.heading}deg)`,
                      transition: 'transform 0.2s',
                    }}
                  >
                    ↑
                  </span>
                </>
              : 'N/A'}
          </dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Altitude</dt>
          <dd>
            {Number.isFinite(flight.altitude)
              ? <>{formatNumber(flight.altitude, 0)} m</>
              : 'N/A'}
          </dd>
        </div>
        <div className="flight-info-card__row">
          <dt>Velocity</dt>
          <dd>
            {Number.isFinite(flight.velocity)
              ? <>{formatNumber(flight.velocity, 0)} m/s</>
              : 'N/A'}
          </dd>
        </div>
      </dl>
    </aside>
  )
}

export default FlightInfoCard

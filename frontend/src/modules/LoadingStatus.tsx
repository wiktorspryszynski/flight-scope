type LoadingStatusProps = {
  overlay?: boolean
}

function LoadingStatus({ overlay = false }: LoadingStatusProps) {
  return (
    <section
      className={`loading-status${overlay ? ' loading-status--overlay' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="loading-status__spinner" aria-hidden />
      <p className="loading-status__label">Flight Scope</p>
      <h2 className="loading-status__title">Loading live flights</h2>
      <p className="loading-status__message">Fetching latest aircraft positions...</p>
    </section>
  )
}

export default LoadingStatus

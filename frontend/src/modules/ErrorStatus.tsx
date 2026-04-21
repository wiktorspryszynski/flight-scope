type ErrorStatusProps = {
  error: string | null
}

function ErrorStatus({ error }: ErrorStatusProps) {
  if (!error) {
    error = "An unknown error occurred. Please try again later."
  }

  return (
    <section className="error-status" role="alert" aria-live="assertive">
      <p className="error-status__label">Flight Scope</p>
      <h2 className="error-status__title">An error occurred</h2>
      <p className="error-status__code">{error}</p>
    </section>
  )
}

export default ErrorStatus

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
      <pre className="error-status__code">
        <code>{error}</code>
      </pre>
    </section>
  )
}

export default ErrorStatus

type ErrorStatusProps = {
  error: string | null
}

function ErrorStatus({ error }: ErrorStatusProps) {
  if (!error) {
    return null
  }

  return <div className="error-div">Error: {error}</div>
}

export default ErrorStatus

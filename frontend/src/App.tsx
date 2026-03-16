import './App.css'
import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

function App() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadFlights = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/flights/live`)
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`)
        }

        const data = await res.json()
        console.log(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
      }
    }

    loadFlights()
  }, [])

  return (
    <>
      <h1>Flight Tracker</h1>
      {error ? <p>API error: {error}</p> : null}
    </> 
  )
}

export default App

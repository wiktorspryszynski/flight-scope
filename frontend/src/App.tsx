import './App.css'
import { useEffect } from 'react'
import FlightsMap from './modules/FlightsMap'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

const getFlightsWebSocketUrl = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/flights'
  url.search = ''
  return url.toString()
}

function App() {
  useEffect(() => {
    let isEffectActive = true
    const wsUrl = getFlightsWebSocketUrl(API_BASE_URL)
    console.log('[Flights WS] connecting to:', wsUrl)
    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
      console.log('[Flights WS] connected')
      if (!isEffectActive) {
        socket.close()
      }
    }

    socket.onmessage = (event) => {
      if (!isEffectActive) {
        console.log('[Flights WS] received message after cleanup, ignoring')
        return
      }
      console.log('[Flights WS] raw message:', event.data)

      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data)
          console.log('[Flights WS] parsed payload:', parsed)
        } catch {
          console.log('[Flights WS] message is not JSON')
        }
      }
    }

    socket.onerror = (event) => {
      console.error('[Flights WS] error event:', event)
    }

    socket.onclose = (event) => {
      console.log('[Flights WS] closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      })
    }

    return () => {
      isEffectActive = false
      console.log('[Flights WS] cleanup, readyState:', socket.readyState)
      // In React StrictMode dev cycle, avoid closing while still connecting.
      if (socket.readyState === WebSocket.OPEN) {
        socket.close()
      }
    }
  }, [])

  if (!MAPTILER_KEY) {
    return null
  }

  return <FlightsMap maptilerKey={MAPTILER_KEY} flights={[]} />
}

export default App

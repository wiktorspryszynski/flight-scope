import './App.css'
import FlightsMap from './modules/FlightsMap'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY

function App() {
  if (!MAPTILER_KEY) {
    return null
  }

  return <FlightsMap maptilerKey={MAPTILER_KEY} />
}

export default App

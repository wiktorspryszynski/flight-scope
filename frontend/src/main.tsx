import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DBDashboard from './modules/DBDashboard.tsx'

const DB_DASHBOARD_PATH = '/admin/db-stats'

console.log(`[flight-scope] DB dashboard: ${window.location.origin}${DB_DASHBOARD_PATH}`)

const root = document.getElementById('root')!

createRoot(root).render(
  <StrictMode>
    {window.location.pathname === DB_DASHBOARD_PATH ? <DBDashboard /> : <App />}
  </StrictMode>,
)

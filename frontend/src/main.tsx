import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import DBDashboard from './modules/DBDashboard.tsx'

console.log(`[flight-scope] DB dashboard: ${window.location.origin}/#/admin/db-stats`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin/db-stats" element={<DBDashboard />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

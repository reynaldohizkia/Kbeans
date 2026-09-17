import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminPanel from './AdminPanel.tsx'

// Routing sederhana tanpa library: kalau path diawali /admin, tampilkan
// panel admin, selain itu tampilkan katalog toko seperti biasa.
const isAdmin = window.location.pathname.startsWith('/admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <AdminPanel /> : <App />}
  </StrictMode>,
)

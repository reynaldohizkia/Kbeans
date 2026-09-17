import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminPanel from './AdminPanel.tsx'
import LoginPage from './LoginPage.tsx'

// Routing sederhana:
// /admin -> Panel Admin
// /login -> Halaman Login (Pelanggan & Admin)
// selain itu -> Katalog Toko
const path = window.location.pathname
const isAdmin = path.startsWith('/admin')
const isLogin = path.startsWith('/login')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <AdminPanel /> : isLogin ? <LoginPage /> : <App />}
  </StrictMode>,
)

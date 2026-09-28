import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // SPA mode: semua rute (termasuk /login, /admin) dikembalikan ke index.html
  appType: 'spa',
})

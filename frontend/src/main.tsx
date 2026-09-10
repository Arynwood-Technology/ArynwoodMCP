import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// In production (Tauri packaged build), the frontend is loaded from local
// files so relative /api/... URLs don't resolve. Rewrite them to point at
// the backend directly — one fix covers every fetch() call in the app.
if (import.meta.env.PROD) {
  const _fetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      input = `http://localhost:8010${input}`
    }
    return _fetch(input, init)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

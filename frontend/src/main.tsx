import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { apiUrl } from './lib/api'

// In production (Tauri packaged build), the frontend is loaded from local
// files so relative /api/... URLs don't resolve. Rewrite them to point at
// the backend directly — one fix covers every fetch() call in the app. Media
// elements and links can't be patched this way; they go through apiUrl() themselves.
if (import.meta.env.PROD) {
  const _fetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') input = apiUrl(input)
    return _fetch(input, init)
  }
}

async function bootstrap() {
  // Demo build (GitHub Pages): wire up mocked fetch/WebSocket before the app renders.
  // Installed *after* the PROD patch above so it wraps outermost — it answers every
  // /api/* call directly and the apiUrl()->localhost:8010 rewrite never runs for those.
  // Dynamic import so none of the demo fixture/scenario content ships in a real build —
  // MODE (not a custom VITE_* var) is what makes this branch reliably fold away to
  // dead code there; see lib/demo/flag.ts's note for why.
  if (import.meta.env.MODE === 'demo') {
    const { installDemoMode } = await import('./lib/demo/bootstrap')
    installDemoMode()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()

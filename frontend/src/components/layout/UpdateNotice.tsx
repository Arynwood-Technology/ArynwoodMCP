import { useEffect, useState } from 'react'
import { DEMO } from '../../lib/demo/flag'
import { checkForUpdate, openRelease, UPDATE_INTERVAL_MS } from '../../lib/updates'
import type { AppUpdate } from '../../lib/updates'

const DISMISSED_KEY = 'arynwood-dismissed-update'

function dismissedVersion(): string | null {
  try { return localStorage.getItem(DISMISSED_KEY) } catch { return null }
}

export function UpdateNotice() {
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [dismissed, setDismissed] = useState(dismissedVersion)
  const [openError, setOpenError] = useState(false)

  useEffect(() => {
    if (DEMO) return
    let stopped = false
    let active: AbortController | null = null
    const check = async () => {
      if (active) return
      const controller = new AbortController()
      active = controller
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const result = await checkForUpdate(controller.signal)
        if (!stopped) setUpdate(result)
      } catch { /* Offline, timeout and rate limits never interrupt the workspace. */ }
      finally { clearTimeout(timeout); active = null }
    }
    void check()
    const interval = setInterval(() => { void check() }, UPDATE_INTERVAL_MS)
    return () => { stopped = true; active?.abort(); clearInterval(interval) }
  }, [])

  if (!update || update.version === dismissed) return null
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-accent/40 bg-surface2 px-5 py-2 text-sm text-text">
      <span>Arynwood MCP {update.version} is available.</span>
      <button type="button" className="cursor-pointer text-accent underline" onClick={() => {
        setOpenError(false)
        void openRelease(update.url).catch(() => setOpenError(true))
      }}>View update</button>
      <button type="button" aria-label="Dismiss update notification" className="ml-auto cursor-pointer text-muted" onClick={() => {
        setDismissed(update.version)
        try { localStorage.setItem(DISMISSED_KEY, update.version) } catch { /* Session dismissal still works. */ }
      }}>Dismiss</button>
      {openError && <span role="alert">Could not open your browser. Visit {update.url}</span>}
    </div>
  )
}

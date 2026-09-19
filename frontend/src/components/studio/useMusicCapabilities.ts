import { useCallback, useEffect, useState } from 'react'
import { getMusicCapabilities } from '../../lib/api'
import type { MusicCapabilities } from '../../lib/api'

// A sidecar reports "running" as soon as it answers /health, which can be a beat before /capabilities has
// finished probing its providers — and /api/music/capabilities answers 200 with an empty provider list (not an
// error) while the sidecar is unreachable. So an empty list from a "running" sidecar means "ask again", not "none".
export const CAPABILITY_RETRY_DELAYS_MS = [1500, 4000, 8000]

/**
 * The song-gen provider list, fetched whenever the sidecar becomes ready — not just when the tab mounts.
 * Fetching only on mount left the list empty for good if the sidecar was started after opening the tab, with the
 * Generate / Jam buttons disabled and a warning telling you to start a sidecar that was already running.
 */
export function useMusicCapabilities(sidecarReady: boolean, retryDelays = CAPABILITY_RETRY_DELAYS_MS) {
  const [capabilities, setCapabilities] = useState<MusicCapabilities | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0) // bumped by retry()

  useEffect(() => {
    if (!sidecarReady) return
    let cancelled = false
    void (async () => {
      for (let i = 0; ; i++) {
        try {
          const caps = await getMusicCapabilities()
          if (cancelled) return
          if (caps.providers.length) { setCapabilities(caps); setFailed(false); return }
        } catch { /* fall through to the retry below */ }
        if (i >= retryDelays.length) { if (!cancelled) setFailed(true); return }
        await new Promise(resolve => setTimeout(resolve, retryDelays[i]))
        if (cancelled) return
      }
    })()
    return () => { cancelled = true }
  }, [sidecarReady, attempt, retryDelays])

  const retry = useCallback(() => { setFailed(false); setAttempt(n => n + 1) }, [])
  const loading = sidecarReady && !capabilities && !failed
  return { capabilities, loading, failed: sidecarReady && failed, retry }
}

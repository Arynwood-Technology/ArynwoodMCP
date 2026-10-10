import { useEffect, useRef } from 'react'
import { groveUrl } from './grove'

// While notices are arriving, a slow poll still runs as a safety net.
const SAFETY_POLL_MS = 60_000
// Each notice stream ends every half minute and the browser reopens it; that gap is not an outage.
const RECONNECT_GRACE_MS = 5_000

/** Refreshes a space's data as soon as any member changes it. The Grove service announces
 *  each change (no content, just "changed"); this polls every `fallbackMs` only while that
 *  connection is down, or where EventSource is unavailable. */
export function useSpaceRefresh(spaceId: string, refresh: () => void, fallbackMs: number) {
  const latest = useRef(refresh)
  useEffect(() => { latest.current = refresh })
  useEffect(() => {
    let last = Date.now(), lastError = 0, pending: ReturnType<typeof setTimeout> | undefined
    const run = () => { last = Date.now(); latest.current() }
    const source = typeof EventSource === 'undefined' ? null : new EventSource(groveUrl(`/community/spaces/${encodeURIComponent(spaceId)}/events`))
    // Several changes in a burst (a list and its items) become one refetch.
    source?.addEventListener('changed', () => { clearTimeout(pending); pending = setTimeout(run, 150) })
    source?.addEventListener('error', () => {
      lastError = Date.now()
      // Refused for good (signed out, or removed from the space): refetch now so the page says so.
      if (source.readyState === EventSource.CLOSED) run()
    })
    const connected = () => !!source && (source.readyState === EventSource.OPEN ||
      (source.readyState === EventSource.CONNECTING && Date.now() - lastError < RECONNECT_GRACE_MS))
    const timer = setInterval(() => { if (!connected() || Date.now() - last >= SAFETY_POLL_MS) run() }, fallbackMs)
    return () => { source?.close(); clearTimeout(pending); clearInterval(timer) }
  }, [spaceId, fallbackMs])
}

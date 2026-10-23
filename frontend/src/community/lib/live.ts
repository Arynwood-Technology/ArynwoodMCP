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
  useLiveRefresh(groveUrl(`/community/spaces/${encodeURIComponent(spaceId)}/events`), refresh, fallbackMs)
}

// One connection per stream for the whole page, however many parts of it listen: without HTTP/2,
// browsers keep only six open to a server, and each stream holds one for as long as it's open.
const shared = new Map<string, { source: EventSource; users: number }>()
function connect(url: string) {
  let entry = shared.get(url)
  if (!entry || entry.source.readyState === EventSource.CLOSED) { entry = { source: new EventSource(url), users: 0 }; shared.set(url, entry) }
  const mine = entry
  mine.users++
  return { source: mine.source, release: () => { if (--mine.users) return; mine.source.close(); if (shared.get(url) === mine) shared.delete(url) } }
}

/** The same for any of the Grove's notice streams, such as a member's Messages. `event` picks the
 *  notices to hear on it: a member's Messages stream also says when a Grove website changes. */
export function useLiveRefresh(url: string, refresh: () => void, fallbackMs: number, event = 'changed') {
  const latest = useRef(refresh)
  useEffect(() => { latest.current = refresh })
  useEffect(() => {
    let last = Date.now(), lastError = 0, pending: ReturnType<typeof setTimeout> | undefined
    const run = () => { last = Date.now(); latest.current() }
    const link = typeof EventSource === 'undefined' ? null : connect(url), source = link?.source
    // Several changes in a burst (a list and its items) become one refetch.
    const heard = () => { clearTimeout(pending); pending = setTimeout(run, 150) }
    const failed = () => {
      lastError = Date.now()
      // Refused for good (signed out, or removed from the space): refetch now so the page says so.
      if (source?.readyState === EventSource.CLOSED) run()
    }
    source?.addEventListener(event, heard)
    source?.addEventListener('error', failed)
    const connected = () => !!source && (source.readyState === EventSource.OPEN ||
      (source.readyState === EventSource.CONNECTING && Date.now() - lastError < RECONNECT_GRACE_MS))
    const timer = setInterval(() => { if (!connected() || Date.now() - last >= SAFETY_POLL_MS) run() }, fallbackMs)
    return () => { source?.removeEventListener(event, heard); source?.removeEventListener('error', failed); link?.release(); clearTimeout(pending); clearInterval(timer) }
  }, [url, fallbackMs, event])
}

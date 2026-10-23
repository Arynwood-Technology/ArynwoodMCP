import { useSyncExternalStore } from 'react'

/** Public chat alerts: none, only when someone says your nickname or writes to you alone, or every message. */
export type ChatAlerts = 'off' | 'mentions' | 'all'
export interface NotifyPrefs { messages: boolean; chat: ChatAlerts }

// Each person's choice, kept in this browser: the browser's permission to notify is per device too.
const KEY = 'grove_notifications'
const CHANGED = 'grove-notify'
/** Fired with a path (detail) when someone clicks a notification; the members' page goes there. */
export const OPEN = 'grove-open'

function read(): NotifyPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { messages: saved.messages === true, chat: ['mentions', 'all'].includes(saved.chat) ? saved.chat : 'off' }
  } catch { return { messages: false, chat: 'off' } }
}
let current = read()
const refresh = () => { current = read() }

export const notifyPrefs = () => current
export const canNotify = () => typeof Notification !== 'undefined'
/** The browser said no for this site; only its own site settings can change that. */
export const notifyBlocked = () => canNotify() && Notification.permission === 'denied'

/** Saves a choice. Turning something on asks the browser's permission first, if it hasn't been asked. */
export async function chooseNotify(change: Partial<NotifyPrefs>) {
  const next = { ...current, ...change }
  if ((next.messages || next.chat !== 'off') && canNotify() && Notification.permission === 'default') {
    try { await Notification.requestPermission() } catch { /* an old browser's callback form */ }
  }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private window: kept until the page closes */ }
  current = next
  window.dispatchEvent(new Event(CHANGED))
}

function subscribe(changed: () => void) {
  const fromAnotherTab = (e: StorageEvent) => { if (e.key === KEY) { refresh(); changed() } }
  window.addEventListener(CHANGED, changed); window.addEventListener('storage', fromAnotherTab)
  return () => { window.removeEventListener(CHANGED, changed); window.removeEventListener('storage', fromAnotherTab) }
}
export function useNotifyPrefs() { return useSyncExternalStore(subscribe, notifyPrefs) }

/** Shows a notification, if this browser allows them. A click brings the Grove forward at `open`. `tag` keeps one per conversation or room. */
export function notify(title: string, body: string, open: string, tag: string) {
  if (!canNotify() || Notification.permission !== 'granted') return
  try {
    // No icon: the desktop app's notifications carry its own.
    const shown = new Notification(title, { body: body.slice(0, 180), tag })
    shown.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent(OPEN, { detail: open })); shown.close() }
  } catch { /* phones that only notify from a service worker */ }
}

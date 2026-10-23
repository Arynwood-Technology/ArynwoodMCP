import { createContext, type MouseEvent } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { apiUrl, wsUrl } from '../../lib/api'
import { downloadFile } from '../../lib/download'

/** The Community page reaches its Grove through Arynwood's backend (backend/routers/community.py),
 *  which holds the Grove sign-in: the desktop web view is a different site from any Grove, so a Grove
 *  cookie there could never be sent. */
export const GROVE_API = '/api/community/grove'
export const groveUrl = (path: string) => apiUrl(GROVE_API + path)
export const groveSocketUrl = (path: string) => wsUrl(GROVE_API + path)
/** An address the Grove gave the page itself, such as its logo (`/api/brand/logo?v=…`), reached the same way. */
export const groveAddress = (url: string) => url.startsWith('/api/') ? groveUrl(url.slice('/api'.length)) : url
/** A Grove look's tokens, with the pictures they name (`url("/api/…")`) reached the same way. */
export const groveTheme = (theme: Record<string, string>) =>
  Object.fromEntries(Object.entries(theme).map(([name, value]) => [name, value.replace(/url\("\/api\//g, `url("${groveUrl('/')}`)]))
/** A website preview (`/api/community/preview/<signed>/…`). Arynwood's backend answers the same path, without the
 *  Grove sign-in, so the addresses the Grove rewrote inside the pages keep working. */
export const previewUrl = (url: string) => apiUrl(url)

/** Opens a page in the system browser: the desktop web view stays on Arynwood. */
export function openExternal(url: string) {
  if (isTauri()) void invoke('plugin:shell|open', { path: url }).catch(() => {})
  else window.open(url, '_blank', 'noopener,noreferrer')
}
/** A link's click handler that opens it with openExternal. */
export function openOutside(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault()
  openExternal(event.currentTarget.href)
}
/** A download link's click handler: saved through a blob, because the desktop web view ignores `download` on
 *  another origin's link (lib/download.ts). */
export const saveLink = (name: string, onError: (e: Error) => void = e => console.error(e)) => (event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault()
  downloadFile(event.currentTarget.href, name).catch(onError)
}

export interface GroveInfo {
  /** The Grove's own address, such as https://grove.example.com: what invitation links name. */
  url: string
  local: boolean
  version: string | null
  /** Open an invitation link the owner pasted, for this Grove or another one. */
  joinLink: (href: string) => void
}

export const GroveContext = createContext<GroveInfo>({ url: window.location.origin, local: true, version: null, joinLink: () => {} })

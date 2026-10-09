import { invoke, isTauri } from '@tauri-apps/api/core'
import { version } from '../../package.json'

export const APP_VERSION = version
export const RELEASES_URL = 'https://github.com/Arynwood-Technology/ArynwoodMCP/releases'
export const UPDATE_API = 'https://api.github.com/repos/Arynwood-Technology/ArynwoodMCP/releases/latest'
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface AppUpdate { version: string; url: string }

function stableVersion(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(value)) return null
  const parts = value.replace(/^v/, '').split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

export function parseUpdate(data: unknown, current = APP_VERSION): AppUpdate | null {
  if (!data || typeof data !== 'object') return null
  const release = data as Record<string, unknown>
  if (release.draft !== false || release.prerelease !== false) return null
  const latest = stableVersion(release.tag_name)
  const installed = stableVersion(current)
  if (!latest || !installed) return null
  const difference = latest.findIndex((part, i) => part !== installed[i])
  if (difference < 0 || latest[difference] <= installed[difference]) return null
  // Construct the destination ourselves; remote metadata never controls navigation.
  return { version: latest.join('.'), url: `${RELEASES_URL}/tag/${release.tag_name}` }
}

/** Public release metadata only: no backend, credentials, chat or model calls. */
export async function checkForUpdate(signal: AbortSignal): Promise<AppUpdate | null> {
  const response = await fetch(UPDATE_API, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error('Update check unavailable')
  if (!response.body) throw new Error('Empty update response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256 * 1024) throw new Error('Update response too large')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return parseUpdate(JSON.parse(text))
  } finally { await reader.cancel() }
}

export async function openRelease(url: string): Promise<void> {
  // An explicit owner click opens the system browser, keeping the desktop webview local.
  if (!url.startsWith(`${RELEASES_URL}/tag/`) || !/^v?\d+\.\d+\.\d+$/.test(url.slice(`${RELEASES_URL}/tag/`.length))) {
    throw new Error('Invalid release URL')
  }
  if (isTauri()) await invoke('plugin:shell|open', { path: url })
  else window.open(url, '_blank', 'noopener,noreferrer')
}

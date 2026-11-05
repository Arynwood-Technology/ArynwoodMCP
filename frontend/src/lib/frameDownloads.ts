import { useEffect, type RefObject } from 'react'
import { downloadFile, saveBlob } from './download'

/**
 * Saves what an html-tool frame (Design Center, Client Intake: static/html-tools/) asks the app's window to save.
 *
 * Those pages run in frames from the backend's origin, and in the desktop app the window is tauri://localhost.
 * WebKitGTK silently drops a download started in a frame from another origin (data: and blob: links alike,
 * measured in the packaged app on 2026-11-04), while the same download from the window works. So the frame
 * posts `{type: 'arynwood:download', name, dataUrl | path}` and the window saves it.
 *
 * Only the given frame is listened to, and only two things are accepted: a base64 data: URL of an image (PNG,
 * JPEG, WebP) or of an HTML page (a generated website, saved as a file and never shown), or a backend file by its
 * /api/ path, fetched the way every other backend download is.
 */
export const DOWNLOAD_MESSAGE = 'arynwood:download'

const DATA_URL = /^data:(image\/(?:png|jpeg|webp)|text\/html);base64,([A-Za-z0-9+/]+={0,2})$/
const BACKEND_PATH = /^\/api\/[\w\-./]+$/
const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/html': 'html' }

/** The file in an accepted data: URL, or null for anything else. */
export function fileFromDataUrl(dataUrl: unknown): Blob | null {
  if (typeof dataUrl !== 'string') return null
  const match = DATA_URL.exec(dataUrl)
  if (!match) return null
  try {
    return new Blob([Uint8Array.from(atob(match[2]), ch => ch.charCodeAt(0))], { type: match[1] })
  } catch {
    return null
  }
}

/** A backend path under /api/, with no `..`, or null. */
export function backendPath(path: unknown): string | null {
  return typeof path === 'string' && BACKEND_PATH.test(path) && !path.split('/').includes('..') ? path : null
}

/** Just a file name: no folders, no control characters, at most 200 characters. */
export function safeFileName(name: unknown, fallback: string): string {
  const base = typeof name === 'string'
    // eslint-disable-next-line no-control-regex
    ? (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
    : ''
  return base && base !== '.' && base !== '..' ? base.slice(0, 200) : fallback
}

export interface DownloadSavers {
  saveBlob: (blob: Blob, filename: string) => void
  downloadFile: (url: string, filename: string) => Promise<void>
}

/**
 * A `message` listener for the window. `frame` returns the frame's window; `origin` is the origin its page is
 * served from. Messages from anywhere else, or of any other shape, are ignored.
 */
export function frameDownloads(
  frame: () => Window | null | undefined,
  origin: string,
  savers: DownloadSavers = { saveBlob, downloadFile },
): (event: MessageEvent) => void {
  return event => {
    const source = frame()
    if (!source || event.source !== source || event.origin !== origin) return
    const data: unknown = event.data
    if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== DOWNLOAD_MESSAGE) return
    const { name, dataUrl, path } = data as { name?: unknown; dataUrl?: unknown; path?: unknown }
    const file = fileFromDataUrl(dataUrl)
    if (file) {
      savers.saveBlob(file, safeFileName(name, `download.${EXTENSION[file.type]}`))
      return
    }
    const backend = backendPath(path)
    if (backend) savers.downloadFile(backend, safeFileName(name, 'download')).catch(err => console.error(err))
  }
}

/** Saves the downloads that the page in `frame` (loaded from `src`) hands to the window. */
export function useFrameDownloads(frame: RefObject<HTMLIFrameElement | null>, src: string): void {
  useEffect(() => {
    const onMessage = frameDownloads(() => frame.current?.contentWindow, new URL(src, window.location.href).origin)
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frame, src])
}

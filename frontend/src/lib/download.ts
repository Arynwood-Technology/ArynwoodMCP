import { apiUrl } from './api'

/**
 * Hand a Blob to the browser's download machinery under a chosen filename.
 *
 * Measured in real WebKitGTK (the desktop app's engine): an `<a download>` pointing at another origin is
 * ignored outright — no download, no error — and the packaged app's page (tauri://localhost) is always a
 * different origin from the backend. A `blob:` URL is same-origin, so the `download` name is honoured
 * (WebKit's `decide-destination` receives it) and the desktop shell saves it into the Downloads folder.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // The download has to read the blob after the click; revoking straight away can truncate it.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

/** Fetch a backend (or any CORS-enabled) file and save it as `filename`. Resolves once the save has been handed off. */
export async function downloadFile(url: string, filename: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(apiUrl(url))
  } catch {
    throw new Error('Could not reach the backend to fetch the file.')
  }
  if (!response.ok) throw new Error(`The server could not provide the file (HTTP ${response.status}).`)
  saveBlob(await response.blob(), filename)
}

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { downloadFile } from '../lib/download'

interface DownloadButtonProps {
  /** A backend path (`/api/...`) or any absolute URL. */
  url: string
  filename: string
  children: ReactNode
  style?: CSSProperties
  title?: string
}

/**
 * A button that downloads a file by fetching it and saving the blob (see lib/download.ts for why a plain
 * `<a download>` can't be used for backend files in the desktop app). Shows why, inline, when it fails.
 */
export function DownloadButton({ url, filename, children, style, title }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onClick() {
    setBusy(true); setError('')
    try { await downloadFile(url, filename) }
    catch (e) { setError(e instanceof Error ? e.message : 'Download failed.') }
    finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" style={style} title={title} disabled={busy} onClick={() => void onClick()}>{children}</button>
      {error && <span role="alert" style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
    </>
  )
}

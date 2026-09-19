import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DownloadButton } from './DownloadButton'

const downloadFile = vi.fn()
vi.mock('../lib/download', () => ({ downloadFile: (...args: unknown[]) => downloadFile(...args) }))

describe('DownloadButton', () => {
  beforeEach(() => downloadFile.mockReset())

  it('downloads the given url under the given filename', async () => {
    downloadFile.mockResolvedValue(undefined)
    render(<DownloadButton url="/api/music/assets/a1/audio" filename="riff.wav">Download</DownloadButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith('/api/music/assets/a1/audio', 'riff.wav'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says why when the download fails, and can be retried', async () => {
    downloadFile.mockRejectedValueOnce(new Error('The server could not provide the file (HTTP 404).')).mockResolvedValueOnce(undefined)
    render(<DownloadButton url="/api/x" filename="x.wav">Download</DownloadButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404')
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('is disabled while a download is in flight', async () => {
    let finish!: () => void
    downloadFile.mockReturnValue(new Promise<void>(r => { finish = r }))
    render(<DownloadButton url="/api/x" filename="x.wav">Download</DownloadButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled())
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled())
  })
})

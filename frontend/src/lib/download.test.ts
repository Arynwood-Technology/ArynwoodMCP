import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { downloadFile, saveBlob } from './download'

describe('saveBlob / downloadFile', () => {
  let clicked: { href: string; download: string }[]

  beforeEach(() => {
    clicked = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:tauri://localhost/uuid-1'), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download })
    })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('saves under the chosen filename through a same-origin blob: URL', () => {
    saveBlob(new Blob(['x']), 'my take.wav')
    expect(clicked).toEqual([{ href: 'blob:tauri://localhost/uuid-1', download: 'my take.wav' }])
    expect(document.querySelector('a[download]')).toBeNull() // the temporary link is removed again
  })

  it('does not revoke the blob before the download has had time to read it', () => {
    vi.useFakeTimers()
    saveBlob(new Blob(['x']), 'a.wav')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:tauri://localhost/uuid-1')
    vi.useRealTimers()
  })

  it('fetches the file first, then saves it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['data']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await downloadFile('/api/music/assets/a1/audio', 'a1.wav')
    expect(fetchMock).toHaveBeenCalledWith('/api/music/assets/a1/audio') // dev: unchanged (PROD is false under test)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('a1.wav')
  })

  it('reports an HTTP error instead of saving an error page as a .wav', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await expect(downloadFile('/api/x', 'x.wav')).rejects.toThrow(/HTTP 404/)
    expect(clicked).toHaveLength(0)
  })

  it('reports an unreachable backend in words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    await expect(downloadFile('/api/x', 'x.wav')).rejects.toThrow(/Could not reach the backend/)
  })
})

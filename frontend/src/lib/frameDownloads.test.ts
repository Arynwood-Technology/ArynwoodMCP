import { describe, it, expect, vi } from 'vitest'
import { backendPath, fileFromDataUrl, frameDownloads, safeFileName } from './frameDownloads'

const ORIGIN = 'http://localhost:8010'
const PNG = 'data:image/png;base64,iVBORw0KGgo='   // the PNG signature

function setup() {
  const frame = {} as Window
  const savers = { saveBlob: vi.fn(), downloadFile: vi.fn().mockResolvedValue(undefined) }
  const listener = frameDownloads(() => frame, ORIGIN, savers)
  const send = (data: unknown, from: { source?: unknown; origin?: string } = {}) =>
    listener({ data, source: from.source ?? frame, origin: from.origin ?? ORIGIN } as MessageEvent)
  return { savers, send }
}

describe('html-tool downloads saved by the window', () => {
  it('saves a canvas image under the name the page chose', async () => {
    const { savers, send } = setup()
    send({ type: 'arynwood:download', name: 'design-1.png', dataUrl: PNG })
    expect(savers.saveBlob).toHaveBeenCalledTimes(1)
    const [blob, name] = savers.saveBlob.mock.calls[0]
    expect(name).toBe('design-1.png')
    expect(blob.type).toBe('image/png')
    const bytes = await new Promise<Uint8Array>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.readAsArrayBuffer(blob)
    })
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('fetches a backend file by its /api/ path', () => {
    const { savers, send } = setup()
    send({ type: 'arynwood:download', name: 'style.safetensors', path: '/api/lora/projects/3/output/style.safetensors' })
    expect(savers.downloadFile).toHaveBeenCalledWith('/api/lora/projects/3/output/style.safetensors', 'style.safetensors')
  })

  it('ignores other windows, other origins and other messages', () => {
    const { savers, send } = setup()
    send({ type: 'arynwood:download', name: 'x.png', dataUrl: PNG }, { source: {} })
    send({ type: 'arynwood:download', name: 'x.png', dataUrl: PNG }, { origin: 'https://evil.example' })
    send({ type: 'something-else', dataUrl: PNG })
    send('arynwood:download')
    expect(savers.saveBlob).not.toHaveBeenCalled()
    expect(savers.downloadFile).not.toHaveBeenCalled()
  })

  it('saves a generated web page as a file', () => {
    const { savers, send } = setup()
    send({ type: 'arynwood:download', name: 'website.html', dataUrl: 'data:text/html;base64,PGgxPg==' })
    expect(savers.saveBlob).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/html' }), 'website.html')
  })

  it('accepts only image or HTML data: URLs and backend paths', () => {
    const { savers, send } = setup()
    send({ type: 'arynwood:download', name: 'a.js', dataUrl: 'data:text/javascript;base64,YWxlcnQoMSk=' })
    send({ type: 'arynwood:download', name: 'a.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })
    send({ type: 'arynwood:download', name: 'a', path: 'https://evil.example/file' })
    send({ type: 'arynwood:download', name: 'a', path: '/api/../config/arynwood.db' })
    send({ type: 'arynwood:download', name: 'a', path: '/html-tools/design-center.html' })
    expect(savers.saveBlob).not.toHaveBeenCalled()
    expect(savers.downloadFile).not.toHaveBeenCalled()
  })

  it('keeps only a file name', () => {
    expect(safeFileName('../../.bashrc', 'x')).toBe('.bashrc')
    expect(safeFileName('a/b\\c.png', 'x')).toBe('c.png')
    expect(safeFileName('bad\u0000name.png', 'x')).toBe('badname.png')
    expect(safeFileName('..', 'fallback.png')).toBe('fallback.png')
    expect(safeFileName(42, 'fallback.png')).toBe('fallback.png')
    expect(fileFromDataUrl('data:image/png;base64,***')).toBeNull()
    expect(backendPath('/api/tools/jobs/7/file')).toBe('/api/tools/jobs/7/file')
  })
})

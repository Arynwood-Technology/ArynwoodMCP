import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bytes, freeName, rebased, siteRoot, uploadFile } from './files'
import { api } from './community'
vi.mock('./community', () => ({ api: vi.fn() }))
const mocked = vi.mocked(api)
const sent: { offset: string | null; size: number }[] = []
let replies: (number | 'drop')[] = []
beforeEach(() => {
  mocked.mockReset(); sent.length = 0; replies = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const reply = replies.shift() ?? 200
    if (reply === 'drop') throw new TypeError('Failed to fetch')
    sent.push({ offset: new URL(url, 'http://grove.test').searchParams.get('offset'), size: (init.body as Blob).size })
    return new Response(JSON.stringify(reply === 200 ? { received: 0 } : { detail: 'Refused.' }), { status: reply })
  }))
  vi.useFakeTimers({ toFake: ['setTimeout'] })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const file = (n: number) => new File([new Uint8Array(n)], 'Screener.mov')

it('sends a file in the pieces the Grove asks for, then finishes it', async () => {
  mocked.mockImplementation(async (path, method) => method === 'POST' && path.endsWith('/uploads') ? { id: 'u1', chunk: 4 } : { id: 'f1' })
  const progress: number[] = []
  await uploadFile('crew', file(10), { folder: 'Press', onProgress: n => progress.push(n) })
  expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/uploads', 'POST', { folder: 'Press', name: 'Screener.mov', size: 10, replaces: null })
  expect(sent).toEqual([{ offset: '0', size: 4 }, { offset: '4', size: 4 }, { offset: '8', size: 2 }])
  expect(progress).toEqual([4, 8, 10])
  expect(mocked).toHaveBeenLastCalledWith('/community/spaces/crew/uploads/u1/finish', 'POST')
})

it('sends a file for Messages the same way, to its own address', async () => {
  const { uploadAttachment } = await import('./messages')
  mocked.mockImplementation(async (path, method) => method === 'POST' && path.endsWith('/uploads') ? { id: 'm1', chunk: 8 } : { id: 'm1', name: 'Screener.mov', size: 10 })
  expect(await uploadAttachment(file(10))).toEqual({ id: 'm1', name: 'Screener.mov', size: 10 })
  expect(mocked).toHaveBeenCalledWith('/messages/uploads', 'POST', { name: 'Screener.mov', size: 10 })
  expect(sent).toEqual([{ offset: '0', size: 8 }, { offset: '8', size: 2 }])
  expect(mocked).toHaveBeenLastCalledWith('/messages/uploads/m1/finish', 'POST')
})

it('picks up where the server got to after a dropped connection', async () => {
  mocked.mockImplementation(async (path, method) => method === 'POST' && path.endsWith('/uploads') ? { id: 'u1', chunk: 4 } : path.endsWith('/u1') ? { received: 4 } : { id: 'f1' })
  replies = [200, 'drop']
  const done = uploadFile('crew', file(8))
  await vi.runAllTimersAsync()
  await done
  expect(sent).toEqual([{ offset: '0', size: 4 }, { offset: '4', size: 4 }])
})

it('falls back to small pieces when a proxy refuses big ones, and reports a refusal', async () => {
  mocked.mockImplementation(async (path, method) => method === 'POST' && path.endsWith('/uploads') ? { id: 'u1', chunk: 4 * 1024 * 1024 } : { id: 'f1' })
  replies = [413]
  await uploadFile('crew', file(1024 * 1024))
  // The refused piece, then the same bytes again in smaller pieces.
  expect(sent.map(s => s.size)).toEqual([1024 * 1024, 768 * 1024, 256 * 1024])
  replies = [403]
  await expect(uploadFile('crew', file(10))).rejects.toThrow('Refused.')
})

it('names sizes and free copies plainly', () => {
  expect([bytes(512), bytes(1536), bytes(15 * 1024 * 1024), bytes(3.2 * 1024 ** 3)]).toEqual(['512 B', '1.5 KB', '15 MB', '3.2 GB'])
  expect(freeName('Poster.png', new Set(['Poster.png', 'Poster (2).png']))).toBe('Poster (3).png')
  expect(freeName('README', new Set(['README']))).toBe('README (2)')
})

it('keeps a site’s own addresses inside its preview, and leaves the Grove’s alone', () => {
  const page = `<link href="/styles.css?v=2"><a href='/faq'>FAQ</a><a href="/community">Members</a><a href="//cdn.example/x.js">x</a><a href="faq">here</a><a title="a > b" href="/after">after</a>
<img src=/img/a.webp srcset="/img/a-480.webp 480w, /img/a-800.webp 800w" style="background:url(/img/bg.svg)"><style>body{background:url('/img/burst.svg')}</style>`
  expect(rebased(page, '/P')).toBe(`<link href="/P/styles.css?v=2"><a href='/P/faq'>FAQ</a><a href="/community">Members</a><a href="//cdn.example/x.js">x</a><a href="faq">here</a><a title="a > b" href="/P/after">after</a>
<img src=/P/img/a.webp srcset="/P/img/a-480.webp 480w, /P/img/a-800.webp 800w" style="background:url(/P/img/bg.svg)"><style>body{background:url('/P/img/burst.svg')}</style>`)
  expect(siteRoot('Website/roguefest-site/docs')).toBe('Website/roguefest-site')
  expect(siteRoot('Press/kit')).toBe('Press/kit')
})

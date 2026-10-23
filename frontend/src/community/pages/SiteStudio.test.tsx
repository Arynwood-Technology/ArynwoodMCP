import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SiteStudio } from './SiteStudio'
import { api, type User } from '../lib/community'
import type { SiteFile, SiteNote } from '../lib/site'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
vi.mock('../lib/live', () => ({ useLiveRefresh: () => {} }))
const mocked = vi.mocked(api)
const owner: User = { id: 'host', name: 'Host', email: 'host@example.test', admin: 1, role: 'owner', can_start_spaces: true, webmaster: true }
const target = { space: 'web', folder: 'Website/roguefest-site', mode: 'edit' as const }
const item = (id: string, folder: string, name: string, extra: Partial<SiteFile> = {}): SiteFile => ({ id, folder, name, kind: 'file', size: 100, version: 1, created: '2026-10-17T09:00:00Z',
  updated: '2026-10-17T09:00:00Z', deleted: null, author_id: 'host', author: 'Host', updated_by: 'Host', draft: null, ...extra })
const files = [item('img', target.folder, 'img', { kind: 'folder', size: 0 }), item('home', target.folder, 'index.html'), item('css', target.folder, 'styles.css', { draft: { version: 1, updated: '' } }),
  item('logo', target.folder + '/img', 'logo.png')]
const saved: Record<string, string> = { home: '<h1>RogueFest</h1>\n<p>Submissions close October 1</p>', css: 'body{color:black}' }
const note: SiteNote = { id: 'n1', space_id: 'web', folder: target.folder, page: '/', selector: 'p:nth-of-type(1)', quote: 'Submissions close October 1', x: 0, y: 0, device: '',
  body: '', suggestion: 'Submissions close October 15', status: 'open', author_id: 'm', author: 'Ann', created: '2026-10-17T09:00:00Z', closed_by: '', closed: null, replies: [] }
beforeEach(() => {
  mocked.mockReset()
  mocked.mockImplementation(async (path, method, body) => {
    if (path.startsWith('/webmaster/files')) return { folder: target.folder, items: files }
    if (path.startsWith('/webmaster/review')) return { space_id: 'web', space_name: 'Website team', folder: target.folder, name: 'roguefest-site', pages: ['index.html'], changed: '1', notes: [note] }
    if (path === '/webmaster/previews') return { url: '/api/community/preview/drafts/' }
    if (path === '/community/spaces/web/files/css/draft' && !method) return { text: 'body{color:hotpink}', version: 1, updated: '' }
    if (path.endsWith('/text') && method === 'PUT') return { ...files[1], version: 2, ...(body as object) }
    return {}
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(saved[/files\/(\w+)\/content/.exec(url)![1]])))
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const code = (name: string) => EditorView.findFromDOM(screen.getByRole('textbox', { name: `Code of ${name}` }))!
async function open() {
  render(<SiteStudio user={owner} target={target} onBack={vi.fn()} onReview={vi.fn()} onFiles={vi.fn()} />)
  await screen.findByRole('textbox', { name: 'Code of index.html' })
  const frame = await screen.findByTitle('Preview, with your unsaved changes') as HTMLIFrameElement
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage')
  await act(async () => {})
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: { grove: 'preview', type: 'page', page: '/', title: 'Home' }, source: frame.contentWindow })) })
  return { frame, said: () => sent.mock.calls.map(([message]) => message as Record<string, unknown>) }
}

it('keeps what is typed as a draft, shows it in the preview, and saves it', async () => {
  const { said } = await open()
  expect(mocked).toHaveBeenCalledWith('/webmaster/previews', 'POST', { space_id: 'web', folder: target.folder, bridge: true, drafts: true })
  // styles.css has a draft from before; now index.html has changes too.
  expect(screen.getByText(/^1 file has changes not saved yet/)).toBeInTheDocument()
  const editor = code('index.html')
  act(() => editor.dispatch({ changes: { from: 4, to: 13, insert: 'Rogue Fest' } }))
  expect(screen.getByText(/^2 files have changes not saved yet/)).toBeInTheDocument()
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/web/files/home/draft', 'PUT', { text: '<h1>Rogue Fest</h1>\n<p>Submissions close October 1</p>', version: 1 }))
  await waitFor(() => expect(said()).toContainEqual({ grove: 'host', type: 'reload' }))
  fireEvent.keyDown(editor.contentDOM, { key: 's', code: 'KeyS', ctrlKey: true })
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/web/files/home/text', 'PUT', { text: '<h1>Rogue Fest</h1>\n<p>Submissions close October 1</p>', version: 1 }))
  expect(await screen.findByText('Saved index.html.')).toBeInTheDocument()
  expect(screen.getByText(/^1 file has changes not saved yet/)).toBeInTheDocument()
})

it('opens a draft left from before, and swaps in new styles without reloading', async () => {
  const { said } = await open()
  expect(within(screen.getByRole('button', { name: /styles\.css/ })).getByLabelText('unsaved changes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /styles\.css/ }))
  const editor = await waitFor(() => code('styles.css'))
  expect(editor.state.doc.toString()).toBe('body{color:hotpink}')
  act(() => editor.dispatch({ changes: { from: 11, to: 18, insert: 'teal' } }))
  await waitFor(() => expect(said()).toContainEqual({ grove: 'host', type: 'styles' }))
  // Back as it was saved: the draft goes.
  act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'body{color:black}' } }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/web/files/css/draft', 'DELETE'))
})

it('puts a note’s suggested wording into the page’s code', async () => {
  await open()
  fireEvent.click(screen.getByRole('tab', { name: /Notes \(1\)/ }))
  fireEvent.click(screen.getByRole('button', { name: /Use this wording/ }))
  await waitFor(() => expect(code('index.html').state.doc.toString()).toBe('<h1>RogueFest</h1>\n<p>Submissions close October 15</p>'))
  expect(screen.getByText(/The new wording is in index.html/)).toBeInTheDocument()
})

it('finds what was clicked in the preview in the code', async () => {
  const { frame, said } = await open()
  fireEvent.click(screen.getByRole('button', { name: 'Find in code' }))
  expect(said()).toContainEqual({ grove: 'host', type: 'pick', on: true })
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: { grove: 'preview', type: 'picked', page: '/', selector: 'h1', quote: 'RogueFest', tag: 'h1', x: 0, y: 0 }, source: frame.contentWindow })) })
  await waitFor(() => { const { from, to } = code('index.html').state.selection.main; expect([from, to]).toEqual([4, 13]) })
  expect(screen.getByText('Found in index.html.')).toBeInTheDocument()
})

it('shows a picture with the address to use it by', async () => {
  await open()
  // Top folders start open.
  expect(screen.getByRole('button', { name: /^img$/ })).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: /logo\.png/ }))
  expect(await screen.findByRole('img', { name: 'logo.png' })).toHaveAttribute('src', '/api/community/grove/community/spaces/web/files/logo/content?inline=1')
  expect(screen.getByText('/img/logo.png')).toBeInTheDocument()
})

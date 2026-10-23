import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SiteReview } from './SiteReview'
import { api, type User } from '../lib/community'
import type { SiteNote, SiteReview as Review } from '../lib/site'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
const refreshers: (() => void)[] = []
vi.mock('../lib/live', () => ({ useLiveRefresh: (_url: string, refresh: () => void) => { refreshers.push(refresh) } }))
const mocked = vi.mocked(api)
const member: User = { id: 'm', name: 'Member', email: 'm@example.test', admin: 0, role: 'member', can_start_spaces: true, webmaster: false }
const target = { space: 'web', folder: 'Website/roguefest-site', mode: 'review' as const }
const note = (extra: Partial<SiteNote> = {}): SiteNote => ({ id: 'n1', space_id: 'web', folder: target.folder, page: '/about', selector: 'main > h1:nth-of-type(1)', quote: 'About RogueFest',
  x: 0.2, y: 0.5, device: 'phone', body: 'Say when it started', suggestion: null, status: 'open', author_id: 'other', author: 'Ann', created: '2026-10-17T09:00:00Z',
  closed_by: '', closed: null, replies: [{ id: 'r1', note_id: 'n1', author_id: 'm', author: 'Member', body: 'Agreed', created: '2026-10-17T09:05:00Z' }], ...extra })
let review: Review
beforeEach(() => {
  refreshers.length = 0
  review = { space_id: 'web', space_name: 'Website team', folder: target.folder, name: 'roguefest-site', pages: ['index.html', 'about.html'], changed: '1', notes: [note()] }
  mocked.mockReset()
  mocked.mockImplementation(async (path, method, body) => path.startsWith('/webmaster/review') ? review : path === '/webmaster/previews' ? { url: '/api/community/preview/tok/' }
    : path === '/webmaster/notes' && method === 'POST' ? { ...note(), ...(body as object), id: 'n2', replies: [] } : {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** What the preview's own script would say from inside the page. */
function fromPage(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: { grove: 'preview', ...data }, source: frame.contentWindow })) })
}
async function open() {
  render(<SiteReview user={member} target={target} onBack={vi.fn()} />)
  const frame = await screen.findByTitle('Preview of roguefest-site') as HTMLIFrameElement
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage')
  // Lets the pane finish setting up, so it's listening before the page speaks.
  await act(async () => {})
  return { frame, sent, said: () => sent.mock.calls.map(([message]) => message as Record<string, unknown>) }
}

it('previews the site with notes pinned to the page they are on', async () => {
  const { frame, said } = await open()
  expect(frame).toHaveAttribute('src', '/api/community/preview/tok/')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox')
  expect(mocked).toHaveBeenCalledWith('/webmaster/previews', 'POST', { space_id: 'web', folder: target.folder, bridge: true, drafts: false })
  expect(screen.getByText('Say when it started')).toBeInTheDocument()
  expect(screen.getByText('About RogueFest')).toBeInTheDocument()
  fromPage(frame, { type: 'page', page: '/about', title: 'About' })
  await waitFor(() => expect(said()).toContainEqual({ grove: 'host', type: 'pins', pins: [expect.objectContaining({ id: 'n1', n: 1, selector: 'main > h1:nth-of-type(1)', done: false })] }), { timeout: 3000 })
  expect(screen.getByLabelText('Page')).toHaveValue('/about')
  // Messages from anywhere but the preview are ignored.
  act(() => { window.dispatchEvent(new MessageEvent('message', { data: { grove: 'preview', type: 'page', page: '/' } })) })
  expect(screen.getByLabelText('Page')).toHaveValue('/about')
})

it('leaves a note with new wording on the spot someone clicked', async () => {
  const { frame, said } = await open()
  fromPage(frame, { type: 'page', page: '/about', title: 'About' })
  fireEvent.click(screen.getByRole('button', { name: /Add a note/ }))
  expect(said()).toContainEqual({ grove: 'host', type: 'pick', on: true })
  expect(screen.getByRole('status')).toHaveTextContent('Click the part of the page your note is about.')
  fromPage(frame, { type: 'picked', page: '/about', selector: 'main > p:nth-of-type(2)', quote: 'Submissions close October 1', tag: 'p', x: 0.25, y: 2 })
  const form = screen.getByRole('heading', { name: 'New note on /about' }).closest('form')!
  expect(within(form).getByText('Submissions close October 1')).toBeInTheDocument()
  fireEvent.click(within(form).getByLabelText('Suggest new wording'))
  expect(within(form).getByLabelText('New wording')).toHaveValue('Submissions close October 1')
  fireEvent.change(within(form).getByLabelText('New wording'), { target: { value: 'Submissions close October 15' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save note' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/webmaster/notes', 'POST', { space_id: 'web', folder: target.folder, page: '/about', selector: 'main > p:nth-of-type(2)',
    quote: 'Submissions close October 1', x: 0.25, y: 1, device: 'computer', body: '', suggestion: 'Submissions close October 15' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: /New note/ })).toBeNull())
})

it('asks for something to change, and notes a whole page', async () => {
  const { frame } = await open()
  fromPage(frame, { type: 'page', page: '/', title: 'Home' })
  fireEvent.click(screen.getByRole('button', { name: /Add a note/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Or write about the whole page' }))
  const form = screen.getByRole('heading', { name: 'New note on the home page' }).closest('form')!
  expect(within(form).getByText('About the whole page')).toBeInTheDocument()
  expect(within(form).queryByLabelText('Suggest new wording')).toBeNull()
  fireEvent.click(within(form).getByRole('button', { name: 'Save note' }))
  expect(within(form).getByRole('alert')).toHaveTextContent('Say what should change.')
  fireEvent.change(within(form).getByLabelText('What should change?'), { target: { value: 'The menu covers the title on phones' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save note' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/webmaster/notes', 'POST', expect.objectContaining({ page: '/', selector: '', quote: '', x: null, y: null, body: 'The menu covers the title on phones' })))
})

it('reloads in place when the site changes, and only then', async () => {
  const { frame, said } = await open()
  fromPage(frame, { type: 'page', page: '/about', title: 'About' })
  fromPage(frame, { type: 'scrolled', page: '/about', x: 0, y: 640 })
  await act(async () => { refreshers.at(-1)!() })
  await waitFor(() => expect(mocked.mock.calls.filter(([path]) => path.startsWith('/webmaster/review'))).toHaveLength(2))
  expect(said().filter(m => m.type === 'reload')).toHaveLength(0)
  review = { ...review, changed: '2' }
  await act(async () => { refreshers.at(-1)!() })
  await waitFor(() => expect(said()).toContainEqual({ grove: 'host', type: 'reload' }))
  expect(await screen.findByText(/Updated/)).toBeInTheDocument()
  // Back on the same page, it scrolls to where the reader was.
  fromPage(frame, { type: 'page', page: '/about', title: 'About' })
  expect(said()).toContainEqual({ grove: 'host', type: 'scroll', x: 0, y: 640 })
})

it('lets someone close their own note but not anyone else’s', async () => {
  review = { ...review, notes: [note(), note({ id: 'n2', author_id: 'm', author: 'Member', body: 'Mine', replies: [] })] }
  await open()
  const [theirs, mine] = screen.getAllByRole('listitem').filter(li => li.classList.contains('note-card'))
  expect(within(theirs).queryByRole('button', { name: /Mark done/ })).toBeNull()
  fireEvent.click(within(mine).getByRole('button', { name: /Mark done/ }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/webmaster/notes/n2', 'PUT', { status: 'done' }))
  fireEvent.change(within(theirs).getByLabelText('Reply'), { target: { value: 'On it' } })
  fireEvent.click(within(theirs).getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/webmaster/notes/n1/replies', 'POST', { body: 'On it' }))
})

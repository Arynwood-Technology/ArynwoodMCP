import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Messages } from './Messages'
import { api, type User } from '../lib/community'
import { shrinkPhoto, uploadAttachment, uploadPhoto, type Thread } from '../lib/messages'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
vi.mock('../lib/messages', async original => ({ ...await original<typeof import('../lib/messages')>(), shrinkPhoto: vi.fn(), uploadPhoto: vi.fn(), uploadAttachment: vi.fn() }))
vi.mock('../lib/live', () => ({ useLiveRefresh: () => {} }))
const mocked = vi.mocked(api)
const me: User = { id: 'me', name: 'Robin', email: 'l@example.test', admin: 1, role: 'owner', can_start_spaces: true }
const chat = { id: 'c1', with: { id: 'sam', name: 'Sam' }, last: 'See you at the venue', last_from_me: false, updated: '2026-10-16T18:00:00Z', unread: 1 }
const thread = (extra: Partial<Thread> = {}): Thread => ({ ...chat, can_write: true, messages: [
  { id: 'm1', sender_id: 'sam', body: 'See you at the venue', photos: [{ id: 'p1', width: 800, height: 600 }], created: '2026-10-16T18:00:00Z', deleted: false, files: [] },
  { id: 'm2', sender_id: 'me', body: '', photos: [], files: [], created: '2026-10-16T18:05:00Z', deleted: true }], ...extra })
beforeEach(() => {
  mocked.mockReset(); vi.mocked(shrinkPhoto).mockReset(); vi.mocked(uploadPhoto).mockReset(); vi.mocked(uploadAttachment).mockReset()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
  mocked.mockImplementation(async (path, method) => path === '/messages/conversations' && !method ? [chat] : path === '/messages/conversations/c1' ? thread() : path === '/messages/conversations/c2' ? thread({ id: 'c2', with: { id: 'ada', name: 'Ada' }, unread: 0, messages: [] })
    : path === '/messages/people' ? [{ id: 'sam', name: 'Sam' }, { id: 'ada', name: 'Ada' }] : path === '/messages/conversations' ? { ...chat, id: 'c2', with: { id: 'ada', name: 'Ada' } } : { ok: true })
})
afterEach(() => cleanup())

it('lists conversations, opens one with its photos, and marks it read', async () => {
  render(<Messages user={me} />)
  fireEvent.click(await screen.findByRole('button', { name: /Sam See you at the venue/ }))
  expect(await screen.findByRole('heading', { name: 'Sam' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open photo' }).querySelector('img')).toHaveAttribute('src', '/api/community/grove/messages/photos/p1')
  expect(screen.getByText('You took this message back.')).toBeInTheDocument()
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/messages/conversations/c1/read', 'POST'))
  fireEvent.click(screen.getByRole('button', { name: 'Open photo' }))
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/community/grove/messages/photos/p1')
})

it('sends words with Enter, and photos once they are ready', async () => {
  vi.mocked(shrinkPhoto).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
  vi.mocked(uploadPhoto).mockResolvedValue({ id: 'new-photo', width: 2048, height: 1536 })
  render(<Messages user={me} />)
  fireEvent.click(await screen.findByRole('button', { name: /Sam/ }))
  const box = await screen.findByLabelText('Message Sam')
  fireEvent.change(box, { target: { value: 'On my way' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/messages/conversations/c1/messages', 'POST', { body: 'On my way', photos: [], files: [] }))
  const photo = new File(['raw'], 'festival.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: [photo] } })
  await waitFor(() => expect(uploadPhoto).toHaveBeenCalled())
  expect(shrinkPhoto).toHaveBeenCalledWith(photo)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/messages/conversations/c1/messages', 'POST', { body: '', photos: ['new-photo'], files: [] }))
})

it('starts a conversation with someone from a shared space', async () => {
  render(<Messages user={me} />)
  fireEvent.click(await screen.findByRole('button', { name: /New message/ }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(within(dialog).getByText('Ada').closest('li') as HTMLElement).getByRole('button', { name: 'Write' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/messages/conversations', 'POST', { user_id: 'ada' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/messages/conversations/c2'))
  expect(await screen.findByText('Say hello to Ada.')).toBeInTheDocument()
})

it('keeps a message to six photos', async () => {
  vi.mocked(shrinkPhoto).mockReturnValue(new Promise(() => {}))
  render(<Messages user={me} />)
  fireEvent.click(await screen.findByRole('button', { name: /Sam/ }))
  const files = Array.from({ length: 8 }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }))
  fireEvent.change(await screen.findByLabelText('Choose photos'), { target: { files } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Up to 6 photos go in one message.')
  expect(screen.getAllByText('Preparing…')).toHaveLength(6)
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
})

it('sends any other file as it is, and shows it to download', async () => {
  let finish!: (value: { id: string; name: string; size: number }) => void
  vi.mocked(uploadAttachment).mockImplementation((_file, onProgress) => { onProgress?.(512); return new Promise(resolve => { finish = resolve }) })
  mocked.mockImplementation(async (path, method) => path === '/messages/conversations' && !method ? [chat] : path === '/messages/conversations/c1'
    ? thread({ messages: [{ id: 'm3', sender_id: 'sam', body: '', photos: [], files: [{ id: 'f1', name: 'Run of show.pdf', size: 245760 }], created: '2026-10-16T18:10:00Z', deleted: false }] }) : { ok: true })
  render(<Messages user={me} />)
  fireEvent.click(await screen.findByRole('button', { name: /Sam/ }))
  const link = await screen.findByRole('link', { name: /Run of show\.pdf/ })
  expect(link).toHaveAttribute('href', '/api/community/grove/messages/files/f1')
  expect(link).toHaveAttribute('download', 'Run of show.pdf')
  expect(within(link).getByText('240 KB')).toBeInTheDocument()
  const budget = new File(['x'.repeat(1024)], 'Budget.xlsx'), huge = new File(['x'], 'Film.mov')
  Object.defineProperty(huge, 'size', { value: 60 * 1024 * 1024 })
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [budget, huge] } })
  const waiting = screen.getByRole('list', { name: 'Files to send' })
  expect(within(waiting).getByText('Sending… 50%')).toBeInTheDocument()
  expect(within(waiting).getByText('Over 50 MB: put it in a space’s Files.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  finish({ id: 'f2', name: 'Budget.xlsx', size: 1024 })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/messages/conversations/c1/messages', 'POST', { body: '', photos: [], files: ['f2'] }))
  expect(uploadAttachment).toHaveBeenCalledTimes(1)
})

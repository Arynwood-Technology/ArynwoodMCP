import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileBank } from './FileBank'
import { api, type Space, type User } from '../lib/community'
import { uploadFile, type FileItem } from '../lib/files'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
vi.mock('../lib/files', async original => ({ ...await original<typeof import('../lib/files')>(), uploadFile: vi.fn() }))
vi.mock('../lib/live', () => ({ useSpaceRefresh: () => {} }))
const mocked = vi.mocked(api), uploading = vi.mocked(uploadFile)
const sam: User = { id: 'sam', name: 'Sam', email: 'sam@example.test', admin: 0, role: 'member', can_start_spaces: true }
const crew: Space = { id: 'crew', name: 'Crew', role: 'member' }
const entry = (id: string, name: string, extra: Partial<FileItem> = {}): FileItem => ({ id, folder: '', name, kind: 'file', size: 2048, version: 1, created: '2026-10-14T09:00:00Z',
  updated: '2026-10-14T09:00:00Z', deleted: null, author_id: 'ada', author: 'Ada', updated_by: 'Ada', ...extra })
const top = [entry('press', 'Press', { kind: 'folder', size: 0 }), entry('poster', 'Poster.png'), entry('mine', 'Notes.txt', { author_id: 'sam', author: 'Sam', updated_by: 'Sam' })]
beforeEach(() => {
  mocked.mockReset(); uploading.mockReset(); uploading.mockResolvedValue(entry('new', 'x'))
  mocked.mockImplementation(async path => path.includes('trash=1') ? { folder: '', items: [entry('old', 'Old cut.mov', { deleted: '2026-10-13T09:00:00Z', author_id: 'sam' })], used: 4096, limit: 10 * 1024 ** 3, file_limit: 1 }
    : path.includes('folder=Press') ? { folder: 'Press', items: [entry('kit', 'Kit.pdf', { folder: 'Press' })], used: 4096, limit: 10 * 1024 ** 3, file_limit: 1 }
    : path.includes('/files?') ? { folder: '', items: top, used: 4096, limit: 10 * 1024 ** 3, file_limit: 1 } : { ok: true })
})
afterEach(() => cleanup())
const show = () => render(<FileBank space={crew} user={sam} />)

it('lists a folder, opens folders, and lets people change only what they added', async () => {
  show()
  expect(await screen.findByText('4.0 KB of 10 GB used')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Download Poster.png' })).toHaveAttribute('href', '/api/community/grove/community/spaces/crew/files/poster/content')
  expect(screen.getByRole('link', { name: 'Download Press as a .zip' })).toHaveAttribute('href', '/api/community/grove/community/spaces/crew/files/press/zip')
  expect(screen.queryByRole('button', { name: 'Delete Poster.png' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Delete Notes.txt' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Press' }))
  expect(await screen.findByRole('button', { name: 'Kit.pdf' })).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/files?folder=Press')
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Folders' })).getByRole('button', { name: 'Files' }))
  expect(await screen.findByRole('button', { name: 'Poster.png' })).toBeInTheDocument()
})

it('asks before uploading over a name, and keeps both when asked', async () => {
  show()
  await screen.findByRole('button', { name: 'Poster.png' })
  const poster = new File(['png'], 'Poster.png'), budget = new File(['csv'], 'Budget.csv')
  fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [poster, budget] } })
  await waitFor(() => expect(uploading).toHaveBeenCalledWith('crew', budget, expect.objectContaining({ folder: '' })))
  const dialog = await screen.findByRole('dialog', { name: 'Poster.png is already here' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }))
  await waitFor(() => expect(uploading).toHaveBeenCalledWith('crew', poster, expect.objectContaining({ name: 'Poster (2).png' })))
})

it('uploads a new version from the same name', async () => {
  show()
  await screen.findByRole('button', { name: 'Poster.png' })
  const poster = new File(['png2'], 'Poster.png')
  fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [poster] } })
  fireEvent.click(await screen.findByRole('button', { name: 'New version' }))
  await waitFor(() => expect(uploading).toHaveBeenCalledWith('crew', poster, expect.objectContaining({ replaces: 'poster' })))
})

it('makes folders, and bins and restores what someone added', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
  // Held back until documents and spreadsheets have proper editors.
  for (const name of ['New spreadsheet', 'New document']) expect(screen.queryByRole('button', { name })).toBeNull()
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sponsors' } })
  fireEvent.click(screen.getByRole('button', { name: 'Make folder' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/folders', 'POST', { folder: '', name: 'Sponsors' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete Notes.txt' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Move to the trash' }))
  await screen.findByText('Notes.txt is in the trash.')
  expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/files/mine', 'DELETE')
  fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
  fireEvent.click(await screen.findByRole('button', { name: /Restore/ }))
  await screen.findByText('Old cut.mov is back.')
  expect(mocked).toHaveBeenCalledWith('/community/spaces/crew/files/old/restore', 'POST')
  // Only a space owner deletes for good.
  expect(screen.queryByRole('button', { name: 'Delete forever' })).toBeNull()
})

it('keeps the Website folder for the Grove’s owners and webmasters to change', async () => {
  mocked.mockImplementation(async path => path.includes('folder=Website') ? { folder: 'Website', items: [entry('page', 'index.html', { folder: 'Website', author_id: 'sam' })], used: 1, limit: 10, file_limit: 1 }
    : { folder: '', items: [entry('site', 'Website', { kind: 'folder', size: 0, author_id: 'sam' })], used: 1, limit: 10, file_limit: 1 })
  // Not even a space owner, nor whoever added a page, changes it without being a webmaster.
  render(<FileBank space={{ ...crew, role: 'owner' }} user={sam} startFolder="Website" />)
  expect(await screen.findByText(/These are the Grove’s website files/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /New folder/ })).toBeNull()
  expect(screen.queryByLabelText('Rename index.html')).toBeNull()
  cleanup()
  render(<FileBank space={crew} user={{ ...sam, webmaster: true }} startFolder="Website" />)
  expect(await screen.findByLabelText('Rename index.html')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Upload/ })).toBeInTheDocument()
  expect(screen.queryByText(/These are the Grove’s website files/)).toBeNull()
})

it('reads a CSV as a table, and as text on request', async () => {
  const sheet = entry('budget', 'Budget.csv', { size: 80 })
  mocked.mockImplementation(async path => path.includes('/files?') ? { folder: '', items: [sheet], used: 80, limit: 10 * 1024 ** 3, file_limit: 1 } : path.endsWith('/versions') ? [] : { ok: true })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Line,Amount,Notes\r\nVenue,"1,200",Deposit paid\r\nPosters,85.50,\r\n')))
  try {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Budget.csv' }))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Line', 'Amount', 'Notes'])
    expect(within(table).getByText('1,200')).toHaveClass('number')
    expect(within(table).getByText('Venue')).not.toHaveClass('number')
    expect(screen.getByText('2 rows, 3 columns')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show as text' }))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/Venue,"1,200",Deposit paid/)).toBeInTheDocument()
  } finally { vi.unstubAllGlobals() }
})

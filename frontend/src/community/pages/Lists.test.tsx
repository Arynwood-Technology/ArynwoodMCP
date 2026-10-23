import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Workspace } from './Workspace'
import { api, type Entry, type Member, type User } from '../lib/community'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
vi.mock('../lib/live', () => ({ useSpaceRefresh: () => {} }))
const mocked = vi.mocked(api)
const me: User = { id: 'me', name: 'Robin', email: 'l@example.test', admin: 0, role: 'member', can_start_spaces: true }
const space = { id: 's1', name: 'RogueFest team', role: 'member' as const }
const members: Member[] = [{ id: 'ann', name: 'Ann', role: 'owner' }, { id: 'bo', name: 'Bo', role: 'member' }, { id: 'me', name: 'Robin', role: 'member' }]
let entries: Entry[]
let made = 0
const entry = (extra: Partial<Entry>): Entry => ({ id: 'e' + ++made, space_id: 's1', author_id: 'ann', author: 'Ann', kind: 'list', title: '', body: '', visibility: 'shared', parent_id: null,
  done: false, due: '', assigned_to: null, created: '2026-10-18T09:00:00Z', updated: '2026-10-18T09:00:00Z', version: 1, ...extra })
beforeEach(() => {
  made = 0
  entries = [entry({ id: 'venue', title: 'Venue', body: 'Everything for the night' }), entry({ id: 'art', title: 'Art show' }), entry({ id: 'anns', title: 'Calls to make', assigned_to: 'ann' }),
    entry({ id: 'mine', title: 'Secret plans', author_id: 'me', visibility: 'private' }),
    entry({ id: 'i3', kind: 'item', title: 'Book sound', parent_id: 'venue', done: true }), entry({ id: 'i2', kind: 'item', title: 'Tables', parent_id: 'venue' }), entry({ id: 'i1', kind: 'item', title: 'Chairs', parent_id: 'venue' })]
  mocked.mockReset()
  mocked.mockImplementation(async (path, method, body) => {
    if (path === '/community/spaces/s1/members') return members
    if (path === '/community/spaces/s1/entries' && !method) return entries
    const sent = body as Partial<Entry>
    if (method === 'POST') { const saved = entry({ ...sent, author_id: 'me', author: 'Robin' }); entries = [saved, ...entries]; return saved }
    if (method === 'PUT') { const saved = { ...entries.find(e => e.id === sent.id)!, ...sent, version: sent.version! + 1 }; entries = entries.map(e => e.id === saved.id ? saved : e); return saved }
    return { ok: true }
  })
})
afterEach(() => cleanup())
const show = () => render(<Workspace section="lists" space={space} user={me} search="" />)
const panel = () => screen.getByRole('tabpanel')
const newList = () => screen.getByLabelText('New list name').closest('form')!

it('puts the Grove’s lists and each person’s on their own tabs', async () => {
  show()
  const tabs = await screen.findAllByRole('tab')
  expect(tabs.map(t => t.textContent)).toEqual(['Grove2', 'RYou', 'AAnn'])
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  // The Grove's lists, in order, and the first one open with what's left to do.
  const picks = within(screen.getByRole('navigation', { name: 'The Grove’s lists' })).getAllByRole('button')
  expect(picks.map(b => b.textContent)).toEqual(['Art showEmpty', 'Venue2 left'])
  fireEvent.click(picks[1])
  const venue = screen.getByRole('region', { name: 'Venue' })
  expect(within(venue).getByText(/Shared by everyone in RogueFest team · 1 of 3 done/)).toBeInTheDocument()
  expect(within(venue).getByText('Everything for the night')).toBeInTheDocument()
  expect(within(venue).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Chairs', 'Tables'])
  // Done things wait behind a button.
  fireEvent.click(within(venue).getByRole('button', { name: 'Show 1 done' }))
  expect(within(venue).getByRole('button', { name: 'Edit Book sound' })).toHaveClass('done')
  // Arrow keys move between tabs; each person's tab has only their lists.
  fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: /You/ })).toHaveAttribute('aria-selected', 'true')
  expect(within(panel()).getByText('Only you can see this list · 0 of 0 done')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Ann/ }))
  expect(screen.getByRole('region', { name: 'Calls to make' })).toHaveTextContent('Ann’s list')
  // Ann's list isn't Robin's to rename.
  expect(screen.queryByRole('button', { name: 'Edit list' })).toBeNull()
  // Coming back to the Grove finds Venue still open.
  fireEvent.click(screen.getByRole('tab', { name: /Grove/ }))
  expect(screen.getByRole('region', { name: 'Venue' })).toBeInTheDocument()
})

it('adds, ticks off and rewords things in place', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: /Venue/ }))
  const venue = screen.getByRole('region', { name: 'Venue' })
  fireEvent.change(within(venue).getByLabelText('Add to Venue'), { target: { value: 'Lights' } })
  fireEvent.click(within(venue).getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/s1/entries', 'POST', { kind: 'item', title: 'Lights', body: '', parent_id: 'venue', visibility: 'shared' }))
  await waitFor(() => expect(within(venue).getByLabelText('Add to Venue')).toHaveValue(''))
  expect(within(venue).getByRole('button', { name: 'Edit Lights' })).toBeInTheDocument()
  fireEvent.click(within(venue).getByRole('button', { name: 'Complete Chairs' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/s1/entries/i1', 'PUT', expect.objectContaining({ done: true })))
  await waitFor(() => expect(within(venue).getByRole('button', { name: 'Show 2 done' })).toBeInTheDocument())
  // Click the words to change them; Enter keeps the change, Escape doesn't.
  fireEvent.click(within(venue).getByRole('button', { name: 'Edit Tables' }))
  const words = within(venue).getByLabelText('Change Tables')
  fireEvent.change(words, { target: { value: 'Tables x6' } })
  fireEvent.keyDown(words, { key: 'Enter' })
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/s1/entries/i2', 'PUT', expect.objectContaining({ title: 'Tables x6' })))
  fireEvent.click(await within(venue).findByRole('button', { name: 'Edit Lights' }))
  fireEvent.change(within(venue).getByLabelText('Change Lights'), { target: { value: 'Nope' } })
  fireEvent.keyDown(within(venue).getByLabelText('Change Lights'), { key: 'Escape' })
  expect(within(venue).getByRole('button', { name: 'Edit Lights' })).toBeInTheDocument()
  expect(mocked.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(2)
  // Items Robin added are hers to delete; Ann's aren't.
  expect(within(venue).getByRole('button', { name: 'Delete Lights' })).toBeInTheDocument()
  expect(within(venue).queryByRole('button', { name: 'Delete Tables x6' })).toBeNull()
})

it('starts a list for someone, and hands one to the Grove', async () => {
  show()
  fireEvent.change(await screen.findByLabelText('Open someone else’s lists'), { target: { value: 'bo' } })
  expect(screen.getByRole('tab', { name: /Bo/ })).toHaveAttribute('aria-selected', 'true')
  expect(within(panel()).getByText('Bo has no lists yet.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Open someone else’s lists')).toBeNull()
  fireEvent.change(screen.getByLabelText('New list name'), { target: { value: 'Posters' } })
  fireEvent.click(within(newList()).getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/s1/entries', 'POST', { kind: 'list', title: 'Posters', body: '', visibility: 'shared', assigned_to: 'bo' }))
  const posters = await screen.findByRole('region', { name: 'Posters' })
  expect(within(posters).getByLabelText('Add to Posters')).toHaveFocus()
  // Robin started it, so she can hand it to the Grove, and it goes with her there.
  fireEvent.click(within(posters).getByRole('button', { name: 'Edit list' }))
  fireEvent.change(within(posters).getByLabelText('Whose list'), { target: { value: '' } })
  fireEvent.click(within(posters).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith(expect.stringMatching(/entries\/e\d+$/), 'PUT', expect.objectContaining({ title: 'Posters', assigned_to: null })))
  await waitFor(() => expect(screen.getByRole('tab', { name: /Grove/ })).toHaveAttribute('aria-selected', 'true'))
  expect(screen.getByRole('region', { name: 'Posters' })).toHaveTextContent('Shared by everyone in RogueFest team')
})

it('keeps a private list on your own tab', async () => {
  show()
  fireEvent.click(await screen.findByRole('tab', { name: /You/ }))
  fireEvent.change(screen.getByLabelText('New list name'), { target: { value: 'Gifts' } })
  fireEvent.click(screen.getByLabelText('Only I can see it'))
  fireEvent.click(within(newList()).getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/s1/entries', 'POST', { kind: 'list', title: 'Gifts', body: '', visibility: 'private', assigned_to: 'me' }))
  expect(await screen.findByRole('region', { name: 'Gifts' })).toHaveTextContent('Only you can see this list')
})

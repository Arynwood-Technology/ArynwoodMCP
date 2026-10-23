import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Settings } from './Settings'
import { api, type Member, type Space } from '../lib/community'
vi.mock('../lib/community', () => ({ api: vi.fn() }))
vi.mock('../components/PublicInviteLink', () => ({ PublicInviteLink: () => null }))
vi.mock('../components/GroveAddress', () => ({ GroveAddress: () => null }))
const mocked = vi.mocked(api)
const me = { id: 'me', name: 'Rowan', email: 'rowan@example.test', admin: 0, role: 'member' as const, can_start_spaces: true }
const home: Space = { id: 'space-1', name: 'Home', topic: 'Sunday dinners', role: 'owner' }
const sam: Member = { id: 'sam', name: 'Sam', role: 'member' }
beforeEach(() => { mocked.mockReset() })
afterEach(() => cleanup())
function show(space: Space, people: Member[]) {
  mocked.mockImplementation(async (path, method) => path.endsWith('/members') ? people : method === 'PUT' && path === '/community/spaces/space-1' ? { ...home, name: 'Our house' } : { ok: true })
  const onLeft = vi.fn(), onChanged = vi.fn()
  render(<Settings space={space} user={me} onLogout={async () => {}} onLeft={onLeft} onChanged={onChanged} />)
  return { onLeft, onChanged }
}

it('lets an owner rename the space and set its topic', async () => {
  const { onChanged } = show(home, [{ id: 'me', name: 'Rowan', role: 'owner' }, sam])
  expect(screen.getByLabelText('Topic')).toHaveValue('Sunday dinners')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Our house' } })
  fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Back on Sundays' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Space saved.')
  expect(mocked).toHaveBeenCalledWith('/community/spaces/space-1', 'PUT', { name: 'Our house', topic: 'Back on Sundays' })
  expect(onChanged).toHaveBeenCalled()
})

it('deletes a space only after its name is typed', async () => {
  const { onLeft } = show(home, [{ id: 'me', name: 'Rowan', role: 'owner' }, sam])
  fireEvent.click(screen.getByRole('button', { name: 'Delete space' }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete Home?' })
  expect(within(dialog).getByText(/All 2 members lose/)).toBeInTheDocument()
  const confirm = within(dialog).getByRole('button', { name: 'Delete space' })
  expect(confirm).toBeDisabled()
  fireEvent.change(within(dialog).getByLabelText('Space name to confirm'), { target: { value: 'Hom' } })
  expect(confirm).toBeDisabled()
  fireEvent.change(within(dialog).getByLabelText('Space name to confirm'), { target: { value: 'Home' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(onLeft).toHaveBeenCalledWith('space-1', 'Home was deleted.'))
  expect(mocked).toHaveBeenCalledWith('/community/spaces/space-1', 'DELETE')
})

it('lets an owner make someone else an owner, but not leave as the only owner', async () => {
  show(home, [{ id: 'me', name: 'Rowan', role: 'owner' }, sam])
  const role = await screen.findByLabelText('Role for Sam')
  expect(screen.getByLabelText('Role for Rowan')).toBeDisabled()
  expect(screen.getByText(/You are the only owner/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Leave this space' })).toBeNull()
  fireEvent.change(role, { target: { value: 'owner' } })
  await screen.findByText('Sam is now an owner and can manage this space.')
  expect(mocked).toHaveBeenCalledWith('/community/spaces/space-1/members/sam', 'PUT', { role: 'owner' })
  expect(screen.getByLabelText('Role for Sam')).toHaveValue('owner')
  expect(screen.getByLabelText('Role for Rowan')).toBeEnabled()
})

it('asks before an owner steps down to member', async () => {
  const { onChanged } = show(home, [{ id: 'me', name: 'Rowan', role: 'owner' }, { ...sam, role: 'owner' }])
  fireEvent.change(await screen.findByLabelText('Role for Rowan'), { target: { value: 'member' } })
  const dialog = await screen.findByRole('dialog', { name: 'Stop being an owner?' })
  expect(mocked).not.toHaveBeenCalledWith('/community/spaces/space-1/members/me', 'PUT', { role: 'member' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Become a member' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(mocked).toHaveBeenCalledWith('/community/spaces/space-1/members/me', 'PUT', { role: 'member' })
})

it('shows a member the people but none of the owner controls', async () => {
  show({ ...home, role: 'member' }, [{ id: 'sam', name: 'Sam', role: 'owner' }, { id: 'me', name: 'Rowan', role: 'member' }])
  await screen.findByText('Sam')
  expect(screen.queryByRole('heading', { name: 'This space' })).toBeNull()
  expect(screen.queryByLabelText(/Role for/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Leave this space' })).toBeInTheDocument()
})

it('shows a name or topic another owner saved while the page is open', async () => {
  mocked.mockImplementation(async path => path.endsWith('/members') ? [{ id: 'me', name: 'Rowan', role: 'owner' }, { ...sam, role: 'owner' }] : { ok: true })
  const props = { user: me, onLogout: async () => {}, onLeft: vi.fn(), onChanged: vi.fn() }
  const view = render(<Settings space={home} {...props} />)
  expect(screen.getByLabelText('Topic')).toHaveValue('Sunday dinners')
  view.rerender(<Settings space={{ ...home, topic: 'Moved to Saturdays' }} {...props} />)
  expect(screen.getByLabelText('Topic')).toHaveValue('Moved to Saturdays')
})

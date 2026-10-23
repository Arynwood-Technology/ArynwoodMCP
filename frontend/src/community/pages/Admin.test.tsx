import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Admin } from './Admin'
import { api, type User } from '../lib/community'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
const mocked = vi.mocked(api)
const rowan: User = { id: 'rowan', name: 'Rowan', email: 'rowan@example.test', admin: 0, role: 'owner', can_start_spaces: true }
const person = (id: string, name: string, role: string, host = 0) => ({ id, name, email: `${id}@example.test`, host, created: '2026-10-01T09:00:00Z', role, spaces: 1, last_active: null })
const people = [person('host', 'Robin', 'owner', 1), person('rowan', 'Rowan', 'owner'), person('sam', 'Sam', 'member')]
const wishes = [{ id: 'w1', created: '2026-10-14T09:00:00Z', author_name: 'Sam', author_email: 'sam@example.test', page: 'calendar', space_name: 'Crew', body: 'A folder for posters', delivery: 'sent' }]
const row = (id: number, action: string, extra = {}) => ({ id, at: '2026-10-14T10:00:00Z', action, actor_id: 'sam', actor_name: 'Sam', space_id: 'crew', space_name: 'Crew', target_id: null, target_name: '', details: {}, ...extra })
const firstPage = { items: [row(3, 'entry_created', { target_name: 'Print badges', details: { kind: 'task' } }), row(2, 'space_created')], next: 2 }
beforeEach(() => { mocked.mockReset() })
afterEach(() => cleanup())
function show(user = rowan) {
  mocked.mockImplementation(async (path, method) => path === '/admin/people' ? people : path === '/admin/spaces' ? [{ id: 'crew', name: 'Crew', created: '2026-10-02T09:00:00Z', used: 5 * 1024 * 1024 }]
    : path === '/admin/wishes' ? wishes : path === '/admin/settings' ? { space_creation: 'everyone', chat_privacy: 'private' }
    : path.includes('before=') ? { items: [row(1, 'signed_in', { space_name: '' })], next: null }
    : path.startsWith('/admin/activity') ? firstPage : method === 'PUT' ? { ok: true } : [])
  const onChanged = vi.fn()
  render(<Admin user={user} onChanged={onChanged} />)
  return { onChanged }
}

it('lets an owner appoint managers, but never change the host', async () => {
  show()
  const sam = await screen.findByLabelText('Grove role for Sam')
  expect(screen.queryByLabelText('Grove role for Robin')).toBeNull()
  expect(screen.getByText('Host · Owner')).toBeInTheDocument()
  fireEvent.change(sam, { target: { value: 'manager' } })
  await screen.findByText('Sam is now a manager: they see everything here.')
  expect(mocked).toHaveBeenCalledWith('/admin/people/sam/role', 'PUT', { role: 'manager' })
})

it('asks before an owner steps down, then reloads who they are', async () => {
  const { onChanged } = show()
  fireEvent.change(await screen.findByLabelText('Grove role for Rowan'), { target: { value: 'manager' } })
  const dialog = await screen.findByRole('dialog', { name: 'Become a manager?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Become a manager' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(mocked).toHaveBeenCalledWith('/admin/people/rowan/role', 'PUT', { role: 'manager' })
})

it('shows a manager everything, but no role or setting controls', async () => {
  show({ ...rowan, role: 'manager' })
  expect(await screen.findByText('A folder for posters')).toBeInTheDocument()
  expect(await screen.findByText('Sam added the task “Print badges” in Crew')).toBeInTheDocument()
  expect(await screen.findByText('Everyone can start spaces.')).toBeInTheDocument()
  expect(screen.getByText(/5.0 MB of files/)).toBeInTheDocument()
  expect(screen.queryByLabelText(/Grove role for/)).toBeNull()
  expect(screen.queryByLabelText('Who can start new spaces')).toBeNull()
})

it('lets an owner keep space-starting to owners and managers', async () => {
  show()
  const setting = await screen.findByLabelText('Who can start new spaces')
  await waitFor(() => expect(setting).toBeEnabled())
  fireEvent.change(setting, { target: { value: 'managers' } })
  await screen.findByText('Only owners and managers can start spaces now.')
  expect(mocked).toHaveBeenCalledWith('/admin/settings', 'PUT', { space_creation: 'managers' })
})

it('lets an owner open Public chat’s room to the IRC network, or keep it private', async () => {
  const { onChanged } = show({ ...rowan, public_chat: { channel: '#RogueFest', nick: 'Guest###', server: 'irc.arynwood.com', private: true } })
  const setting = await screen.findByLabelText('Who can find and join #RogueFest')
  await waitFor(() => expect(setting).toBeEnabled())
  expect(setting).toHaveValue('private')
  fireEvent.change(setting, { target: { value: 'open' } })
  await screen.findByText('Anyone on irc.arynwood.com can now find and join #RogueFest.')
  expect(mocked).toHaveBeenCalledWith('/admin/settings', 'PUT', { chat_privacy: 'open' })
  expect(onChanged).toHaveBeenCalled()
})

it('shows no Public chat setting on a Grove without a room', async () => {
  show()
  await screen.findByLabelText('Who can start new spaces')
  expect(screen.queryByRole('heading', { name: 'Public chat' })).toBeNull()
})

it('filters the log by person or space, and pages back through it', async () => {
  show()
  await screen.findByText('Sam started the space Crew')
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'sam' } })
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/admin/activity?person=sam'))
  fireEvent.click(await screen.findByRole('button', { name: 'Activity in Crew' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/admin/activity?space=crew'))
  fireEvent.click(await screen.findByRole('button', { name: 'Show older' }))
  expect(await screen.findByText('Sam signed in')).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/admin/activity?space=crew&before=2')
  expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
})

it('lets an owner choose webmasters; owners look after the website anyway', async () => {
  show()
  const sam = await screen.findByLabelText('Webmaster: Sam')
  expect(screen.queryByLabelText('Webmaster: Rowan')).toBeNull()
  fireEvent.click(sam)
  await screen.findByText('Sam is now a webmaster: they change and publish the website.')
  expect(mocked).toHaveBeenCalledWith('/admin/people/sam/webmaster', 'PUT', { webmaster: true })
})

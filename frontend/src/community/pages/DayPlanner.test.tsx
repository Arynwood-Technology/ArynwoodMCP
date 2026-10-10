import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DayPlanner } from './DayPlanner'
import { api } from '../lib/community'
vi.mock('../lib/community', () => ({ api: vi.fn() }))
const mocked = vi.mocked(api)
const me = { id: 'me', name: 'Rowan', email: 'rowan@example.test', admin: 0 }
const people = [{ id: 'me', name: 'Rowan', role: 'owner' }, { id: 'sam', name: 'Sam', role: 'member' }]
const bins = { id: 'bins', space_id: 'home', author_id: 'me', author: 'Rowan', kind: 'task', title: 'Bins out', body: '', visibility: 'shared', parent_id: null, done: 0, due: '', assigned_to: 'sam', created: '2026-10-10T09:00:00Z', updated: '2026-10-10T09:00:00Z', version: 1 }
beforeEach(() => { mocked.mockReset(); mocked.mockImplementation(async path => path.endsWith('/members') ? people : path.endsWith('/entries') ? [bins] : bins) })
afterEach(() => cleanup())
const show = () => render(<MemoryRouter><DayPlanner space={{ id: 'home', name: 'Home', role: 'owner' }} user={me} /></MemoryRouter>)

it('shows who a task is assigned to and assigns a new one', async () => {
  show()
  expect(await screen.findByRole('button', { name: /Bins out\s*Sam/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add daily goal' }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Book the vet' } })
  fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'sam' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/community/spaces/home/entries', 'POST', expect.objectContaining({ kind: 'task', title: 'Book the vet', assigned_to: 'sam' })))
})

it('offers only you for a private task', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Add daily goal' }))
  expect(screen.getByRole('option', { name: 'Sam' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'private' } })
  expect(screen.queryByRole('option', { name: 'Sam' })).toBeNull()
  expect(screen.getByRole('option', { name: 'Rowan (you)' })).toBeInTheDocument()
})

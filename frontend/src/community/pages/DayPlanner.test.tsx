import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DayPlanner } from './DayPlanner'
import { api } from '../lib/community'
vi.mock('../lib/community', () => ({ api: vi.fn() }))
const mocked = vi.mocked(api)
const me = { id: 'me', name: 'Rowan', email: 'rowan@example.test', admin: 0, role: 'member' as const, can_start_spaces: true }
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
  const form = screen.getByRole('dialog')
  expect(within(form).getByRole('option', { name: 'Sam' })).toBeInTheDocument()
  fireEvent.change(within(form).getByLabelText('Visibility'), { target: { value: 'private' } })
  expect(within(form).queryByRole('option', { name: 'Sam' })).toBeNull()
  expect(within(form).getByRole('option', { name: 'Rowan (you)' })).toBeInTheDocument()
})

it('opens on the month, with the chosen day beside it', async () => {
  const now = new Date(), year = now.getFullYear(), month = now.getMonth()
  const iso = (d: number, h: number) => new Date(year, month, d, h).toISOString()
  const screening = { ...bins, id: 'film', kind: 'event', title: 'Opening night', due: iso(20, 19), assigned_to: null }
  const lists = [{ ...bins, id: 'pack', kind: 'list', title: 'Packing', assigned_to: null }, { ...bins, id: 'tape', kind: 'item', title: 'Gaffer tape', parent_id: 'pack', assigned_to: null }]
  mocked.mockImplementation(async path => path.endsWith('/members') ? people : [screening, ...lists])
  show()
  const title = new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Packing' })).getByRole('button', { name: 'Complete Gaffer tape' })).toBeInTheDocument()
  const twentieth = new Date(year, month, 20)
  const cell = screen.getByRole('button', { name: `${twentieth.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, 1 scheduled` })
  expect(cell).toHaveTextContent('Opening night')
  fireEvent.click(cell)
  expect(cell).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: twentieth.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) })).toBeInTheDocument()
  expect(screen.getByText('1 scheduled', { exact: false })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  expect(screen.getByRole('heading', { name: new Date(year, month + 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }) })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Today' }))
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
})

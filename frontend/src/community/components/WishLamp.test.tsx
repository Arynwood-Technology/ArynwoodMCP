import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WishLamp } from './WishLamp'
import { api } from '../lib/community'
vi.mock('../lib/community', () => ({ api: vi.fn() }))
const mocked = vi.mocked(api)
beforeEach(() => { mocked.mockReset() })
afterEach(() => cleanup())

it('sends a wish with the page and space it was made on', async () => {
  mocked.mockResolvedValue({ id: 'w1', emailed: true })
  render(<WishLamp page="calendar" spaceId="crew" />)
  fireEvent.click(screen.getByRole('button', { name: 'Make a wish' }))
  const send = await screen.findByRole('button', { name: 'Send wish' })
  expect(send).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Your wish'), { target: { value: 'A folder for festival posters' } })
  fireEvent.click(send)
  await screen.findByText('Your wish is on its way. Thank you!')
  expect(mocked).toHaveBeenCalledWith('/wishes', 'POST', { body: 'A folder for festival posters', page: 'calendar', space_id: 'crew' })
})

it('keeps the words when sending fails', async () => {
  mocked.mockRejectedValue(new Error('Try again in 15 minutes.'))
  render(<WishLamp page="admin" />)
  fireEvent.click(screen.getByRole('button', { name: 'Make a wish' }))
  fireEvent.change(await screen.findByLabelText('Your wish'), { target: { value: 'Dark mode for the planner' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send wish' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 15 minutes.')
  expect(screen.getByLabelText('Your wish')).toHaveValue('Dark mode for the planner')
})

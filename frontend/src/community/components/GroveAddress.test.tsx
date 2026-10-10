import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GroveAddress } from './GroveAddress'
import { api } from '../lib/community'
vi.mock('../lib/community', () => ({ api: vi.fn() }))
afterEach(() => { cleanup(); vi.mocked(api).mockReset(); vi.useRealTimers() })

const temporary = { address: 'https://203-0-113-5.sslip.io', host: '203-0-113-5.sslip.io', temporary: true, server_ip: '203.0.113.5', can_change: true, pending: null, result: null }

it('shows the DNS record to add, then moves the Grove once the domain points here', async () => {
  let state: Record<string, unknown> = { ...temporary }
  let points = false
  vi.mocked(api).mockImplementation(async (path, _method, body) => {
    if (path === '/grove-setup/address') return state
    if (path === '/grove-setup/check-domain') return { domain: 'grove.example.com', addresses: points ? ['203.0.113.5'] : [], points_here: points, record: { type: 'A', name: 'grove', value: '203.0.113.5' } }
    if (path === '/grove-setup/domain') { expect(body).toEqual({ domain: 'grove.example.com', email: '' }); state = { ...state, pending: 'grove.example.com' }; return { pending: 'grove.example.com' } }
  })
  render(<GroveAddress />)
  expect(await screen.findByText(/a temporary address/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Your domain'), { target: { value: 'grove.example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  expect(await screen.findByText(/has no address yet/)).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: 'grove' })).toBeInTheDocument()
  expect(screen.getByText('203.0.113.5')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Use grove/ })).toBeNull()  // nothing to switch to yet
  points = true
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use grove.example.com' }))
  expect(screen.getByText(/everyone signs in again at the new address/)).toBeInTheDocument()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(screen.getByRole('button', { name: 'Switch to grove.example.com' }))
  expect(await screen.findByText(/Moving your Grove to grove.example.com/)).toBeInTheDocument()
  state = { ...state, pending: null, address: 'https://grove.example.com', temporary: false, result: { status: 'done', domain: 'grove.example.com', message: '' } }
  await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
  expect(await screen.findByRole('link', { name: 'https://grove.example.com' })).toHaveAttribute('href', 'https://grove.example.com/community')
})

it('says where the address is set when the server installer did not set up this Grove', async () => {
  vi.mocked(api).mockResolvedValue({ ...temporary, address: 'https://community.example.org', temporary: false, can_change: false })
  render(<GroveAddress />)
  expect(await screen.findByText(/set on its server/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Your domain')).toBeNull()
})

it('reports a failed move and lets the host try again', async () => {
  vi.mocked(api).mockResolvedValue({ ...temporary, result: { status: 'failed', domain: 'grove.example.com', message: 'http://grove.example.com does not reach this server yet.', finished: Date.now() / 1000 - 60 } })
  render(<GroveAddress />)
  expect(await screen.findByRole('alert')).toHaveTextContent('does not reach this server yet. Nothing was changed.')
  expect(screen.getByLabelText('Your domain')).toBeInTheDocument()
})

it('offers the form again on a later visit after a move', async () => {
  vi.mocked(api).mockResolvedValue({ ...temporary, address: 'https://grove.example.com', host: 'grove.example.com', temporary: false,
    result: { status: 'done', domain: 'grove.example.com', message: '', finished: Date.now() / 1000 - 30 } })
  render(<GroveAddress />)
  expect(await screen.findByLabelText('Your domain')).toBeInTheDocument()
  expect(screen.queryByText(/Your Grove is now at/)).toBeNull()
})

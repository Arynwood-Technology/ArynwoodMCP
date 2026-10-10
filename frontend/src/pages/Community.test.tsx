import { useContext } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Community } from './Community'
import { GroveContext } from '../community/lib/grove'
import { JoinByLink } from '../community/components/JoinByLink'
import * as api from '../lib/api'
import type { CommunityStatus } from '../lib/api'

vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  getCommunityStatus: vi.fn(), setCommunityAddress: vi.fn(), startCommunity: vi.fn(),
  stopCommunity: vi.fn(), openCommunity: vi.fn(),
}))
// Grove's own screens have their own tests; here, show what the Community page hands them.
vi.mock('../community/Community', () => ({
  Community: () => {
    const grove = useContext(GroveContext)
    return <div>
      <p>Grove screens for {grove.url} ({grove.local ? 'local' : 'remote'}, {grove.version})</p>
      <JoinByLink />
    </div>
  },
}))

const base: CommunityStatus = {
  label: 'Arynwood Grove', mode: 'local', url: 'http://127.0.0.1:8018', default_url: 'http://127.0.0.1:8018',
  status: 'running', version: '0.4.0', dir: '~/GitHub/arynwood-community', repo_url: 'https://github.com/example/grove',
  installed: true, setup_missing: [], managed: false, can_start: false, can_stop: false, error: null,
}
const status = vi.mocked(api.getCommunityStatus)
const setAddress = vi.mocked(api.setCommunityAddress)

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{pathname + search}</div>
}
function show() {
  render(<MemoryRouter initialEntries={['/community']}>
    <Routes><Route path="/community/*" element={<><Community /><Where /></>} /></Routes>
  </MemoryRouter>)
}
function paste(link: string) {
  fireEvent.change(screen.getByLabelText('Invitation link'), { target: { value: link } })
  fireEvent.click(screen.getByRole('button', { name: /Join/ }))
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(cleanup)

describe('Community page', () => {
  it('shows the Grove screens with that Grove\'s address once it is running', async () => {
    status.mockResolvedValue(base)
    show()
    expect(await screen.findByText('Grove screens for http://127.0.0.1:8018 (local, 0.4.0)')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Running · v0.4.0')
  })

  it('explains and offers Start when the Grove on this computer is stopped', async () => {
    status.mockResolvedValue({ ...base, status: 'stopped', version: null, can_start: true })
    vi.mocked(api.startCommunity).mockResolvedValue({ status: 'starting' })
    show()
    expect(await screen.findByText(/isn't running. Start it above/)).toBeInTheDocument()
    expect(screen.queryByText(/Grove screens/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(api.startCommunity).toHaveBeenCalled())
  })

  it('changes Grove and returns to the default', async () => {
    const hosted = { ...base, mode: 'remote' as const, url: 'https://grove.example.com', dir: null }
    status.mockResolvedValueOnce(base).mockResolvedValue(hosted)
    setAddress.mockResolvedValue(hosted)
    show()
    await screen.findByText(/Grove screens/)
    fireEvent.click(screen.getByRole('button', { name: 'Change Grove' }))
    fireEvent.change(screen.getByLabelText('Grove address'), { target: { value: 'grove.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this Grove' }))
    await waitFor(() => expect(setAddress).toHaveBeenCalledWith('grove.example.com'))
    expect(await screen.findByText('Grove screens for https://grove.example.com (remote, 0.4.0)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change Grove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to 127.0.0.1:8018' }))
    await waitFor(() => expect(setAddress).toHaveBeenLastCalledWith(null))
  })

  it('shows why an address was refused', async () => {
    status.mockResolvedValue(base)
    setAddress.mockRejectedValue(new Error(JSON.stringify({ detail: 'Use an https:// address for a Grove on another computer.' })))
    show()
    await screen.findByText(/Grove screens/)
    fireEvent.click(screen.getByRole('button', { name: 'Change Grove' }))
    fireEvent.change(screen.getByLabelText('Grove address'), { target: { value: 'http://grove.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this Grove' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use an https:// address for a Grove on another computer.')
  })

  it('joins an invitation to this Grove in place', async () => {
    status.mockResolvedValue(base)
    show()
    await screen.findByText(/Grove screens/)
    paste('http://127.0.0.1:8018/community?invite=abcdef0123456789')
    expect(screen.getByTestId('location')).toHaveTextContent('/community?invite=abcdef0123456789')
    expect(setAddress).not.toHaveBeenCalled()
  })

  it('asks before switching to the Grove an invitation belongs to, and joins inside the app', async () => {
    const hosted = { ...base, mode: 'remote' as const, url: 'https://grove.example.com', dir: null }
    status.mockResolvedValue(base)
    setAddress.mockResolvedValue(hosted)
    show()
    await screen.findByText(/Grove screens/)
    paste('https://grove.example.com/community?invite=abcdef0123456789')
    expect(screen.getByRole('alert')).toHaveTextContent('This invitation is for the Grove at grove.example.com')
    expect(setAddress).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use grove.example.com' }))
    await waitFor(() => expect(setAddress).toHaveBeenCalledWith('https://grove.example.com'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/community?invite=abcdef0123456789'))
  })
})

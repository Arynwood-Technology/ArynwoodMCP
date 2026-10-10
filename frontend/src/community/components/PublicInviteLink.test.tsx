import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PublicInviteLink } from './PublicInviteLink'
import { api } from '../lib/community'
vi.mock('../lib/community', () => ({ api: vi.fn() }))
afterEach(() => { cleanup(); vi.mocked(api).mockReset() })

it('creates, copies, replaces and turns off a space’s public link', async () => {
  let current: string | null = null, n = 0
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === 'POST') { current = `token-${++n}`; return { token: current, url: `https://grove.example.test/community?invite=${current}` } }
    if (method === 'DELETE') { current = null; return { ok: true } }
    return { token: current, url: current && `https://grove.example.test/community?invite=${current}` }
  })
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  render(<PublicInviteLink spaceId="home" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create public link' }))
  expect(await screen.findByLabelText('Public invite link address')).toHaveValue('https://grove.example.test/community?invite=token-1')
  expect(api).toHaveBeenCalledWith('/community/spaces/home/invite-link', 'POST')
  fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('https://grove.example.test/community?invite=token-1'))
  fireEvent.click(screen.getByRole('button', { name: /New link/ }))
  expect(await screen.findByText('New link created. The old one no longer works.')).toBeInTheDocument()
  expect(screen.getByLabelText('Public invite link address')).toHaveValue('https://grove.example.test/community?invite=token-2')
  fireEvent.click(screen.getByRole('button', { name: /Turn off/ }))
  expect(await screen.findByText('Public link turned off. It no longer works.')).toBeInTheDocument()
  expect(api).toHaveBeenCalledWith('/community/spaces/home/invite-link', 'DELETE')
  expect(screen.getByRole('button', { name: 'Create public link' })).toBeInTheDocument()
})

it('shows an existing link when the dialog opens', async () => {
  vi.mocked(api).mockResolvedValue({ token: 'kept', url: null })
  render(<PublicInviteLink spaceId="home" />)
  expect(await screen.findByLabelText('Public invite link address')).toHaveValue(`${location.origin}/community?invite=kept`)
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LookAndFeel, type Look, type LookState } from './LookAndFeel'
import { api } from '../lib/community'
import { LOOK_CHANGED, themeStyle } from '../lib/brand'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
const mocked = vi.mocked(api)
const look: Look = { name: 'RogueFest Community', tagline: 'Come see what you find.', background: '#091c32', text: '#f4eee8', accent: '#e2326f', login_background: '',
  font_heading: 'clean', font_body: 'clean', corners: 'round', logo_shape: 'original', site_url: 'https://roguefestfilmfestival.com/', site_label: 'Festival website', shop_url: '', shop_label: '' }
const state = (extra: Partial<LookState> = {}): LookState => ({ look, custom: true, theme: {}, logo_url: '/api/brand/logo?v=abc', picture_url: '', sizes: { logo: 524288, picture: 2097152 }, ...extra })
const site = { space_id: 'crew', space_name: 'Crew', folder: 'Website/roguefest-site', name: 'roguefest-site', member: true, files: 59, bytes: 1, updated: '' }
let preview: Record<string, string> = {}
function serve(more: (path: string, method?: string, body?: unknown) => unknown = () => undefined) {
  mocked.mockImplementation(async (path, method, body) => more(path, method, body) ?? (path === '/brand/look' ? state() : path === '/brand/look/preview' ? { theme: preview }
    : path === '/webmaster/site' ? { live: null, releases: [], sites: [site] } : {}))
}
beforeEach(() => { mocked.mockReset(); preview = { '--bg': '#091c32', '--text': '#f4eee8', '--accent': '#e2326f', '--login-base': '#091c32' } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('previews each change, then saves the look and tells the page around it', async () => {
  serve((path, method, body) => path === '/brand/look' && method === 'PUT' ? state({ look: body as Look }) : undefined)
  const changed = vi.fn(); window.addEventListener(LOOK_CHANGED, changed)
  render(<LookAndFeel />)
  expect(await screen.findByDisplayValue('RogueFest Community')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Background code'), { target: { value: '#f4eee8' } })
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/brand/look/preview', 'POST', expect.objectContaining({ background: '#f4eee8' })))
  fireEvent.change(screen.getByLabelText('Headings'), { target: { value: 'bold' } })
  fireEvent.click(screen.getByRole('button', { name: /Save/ }))
  expect(await screen.findByText('Saved. Everyone sees the new look the next time a page opens.')).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/brand/look', 'PUT', expect.objectContaining({ background: '#f4eee8', font_heading: 'bold' }))
  expect(changed).toHaveBeenCalled()
  window.removeEventListener(LOOK_CHANGED, changed)
})

it('says when a colour is shown differently so it stays readable, and lets text be automatic', async () => {
  preview = { '--bg': '#a9a9a9', '--text': '#1c2326', '--accent': '#e2326f', '--login-base': '#091c32' }
  serve(); render(<LookAndFeel />)
  fireEvent.change(await screen.findByLabelText('Background code'), { target: { value: '#777777' } })
  expect(await screen.findByText('Shown as #a9a9a9 so it stays readable.')).toBeInTheDocument()
  fireEvent.click(within(screen.getByText('Text').closest('.look-colour') as HTMLElement).getByLabelText('Automatic'))
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/brand/look/preview', 'POST', expect.objectContaining({ text: '' })))
  expect(screen.getByLabelText('Text code')).toHaveAttribute('placeholder', 'Automatic')
})

it('takes the look from a website, and its logo when asked', async () => {
  serve(path => path === '/brand/look/from-site' ? { background: '#091c32', text: '#f4eee8', accent: '#c22059', font_heading: 'bold', font_body: 'clean',
    logo: { file_id: 'badge', name: 'roguefest-badge-320.webp', space_id: 'crew' }, picture: { file_id: 'share', name: 'roguefest-share.jpg', space_id: 'crew' } }
    : path === '/brand/look/logo/from-file' ? state({ logo_url: '/api/brand/logo?v=new' }) : undefined)
  render(<LookAndFeel />)
  fireEvent.change(await screen.findByLabelText('Website'), { target: { value: 'crew\nWebsite/roguefest-site' } })
  expect(await screen.findByText(/Filled in from roguefest-site/)).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/brand/look/from-site', 'POST', { space_id: 'crew', folder: 'Website/roguefest-site' })
  expect(screen.getByLabelText('Accent code')).toHaveValue('#c22059')
  expect(screen.getByLabelText('Headings')).toHaveValue('bold')
  fireEvent.click(screen.getByRole('button', { name: 'Use as the logo' }))
  expect(await screen.findByText('Your website’s logo is now the logo.')).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/brand/look/logo/from-file', 'POST', { space_id: 'crew', file_id: 'badge' })
})

it('uploads a picture as it is, and goes back to the host’s look after asking', async () => {
  serve(path => path === '/brand/look' && mocked.mock.calls.some(([, m]) => m === 'DELETE') ? state({ custom: false }) : undefined)
  const fetched = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(state({ picture_url: '/api/brand/picture?v=1' })), { status: 200 }))
  render(<LookAndFeel />)
  const picture = new File(['jpeg'], 'audience.jpg', { type: 'image/jpeg' })
  fireEvent.change(await screen.findByLabelText('Upload a login picture'), { target: { files: [picture] } })
  expect(await screen.findByText('The new login picture is in place.')).toBeInTheDocument()
  expect(fetched).toHaveBeenCalledWith('/api/community/grove/brand/look/picture', expect.objectContaining({ method: 'PUT', body: picture, headers: expect.objectContaining({ 'X-Community-Request': '1' }) }))
  fireEvent.click(screen.getByRole('button', { name: /Back to the host’s look/ }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Go back' }))
  expect(await screen.findByText('This Grove looks as its host set it up again.')).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/brand/look', 'DELETE')
})

it('turns a look into a style the browser understands', () => {
  expect(themeStyle({ '--bg': '#ffffff', '--scheme': 'light' })).toEqual({ '--bg': '#ffffff', colorScheme: 'light' })
})

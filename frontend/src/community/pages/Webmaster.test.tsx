import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Webmaster, type Release, type Site, type SiteImport, type SiteState } from './Webmaster'
import { api, type Space, type User } from '../lib/community'
import { uploadFile, type FileItem } from '../lib/files'
vi.mock('../lib/community', async original => ({ ...await original<typeof import('../lib/community')>(), api: vi.fn() }))
vi.mock('../lib/files', async original => ({ ...await original<typeof import('../lib/files')>(), uploadFile: vi.fn() }))
const mocked = vi.mocked(api)
const spaces: Space[] = [{ id: 'crew', name: 'Crew', role: 'owner' }, { id: 'web', name: 'Website team', role: 'member' }]
const owner: User = { id: 'host', name: 'Host', email: 'host@example.test', admin: 1, role: 'owner', can_start_spaces: true, webmaster: true }
const member: User = { ...owner, id: 'm', name: 'Member', admin: 0, role: 'member', webmaster: false }
const job = (extra: Partial<SiteImport> = {}): SiteImport => ({ id: 'i1', space_id: 'web', space_name: 'Website team', url: 'https://roguefestfilmfestival.com/',
  folder: 'Website/roguefestfilmfestival.com', status: 'done', added: 20, changed: 0, unchanged: 0, skipped: 1, bytes: 6 * 1024 * 1024, message: '',
  started: '2026-10-15T09:00:00Z', finished: '2026-10-15T09:01:00Z', notes: { elsewhere: ['player.vimeo.com', 'filmfreeway.com'], skipped: [['/assets/submission-burst.svg', 'the site answered 404']], server: 'cloudflare' }, ...extra })
const site: Site = { space_id: 'web', space_name: 'Website team', folder: 'Website/roguefest-site', name: 'roguefest-site', member: true, files: 75, bytes: 1800000, updated: '2026-10-16T09:00:00Z', notes: 0 }
const release = (extra: Partial<Release> = {}): Release => ({ id: 'r1', space_id: 'web', space_name: 'Website team', folder: 'Website/roguefest-site', files: 75, bytes: 1800000,
  user_name: 'Host', created: '2026-10-16T10:00:00Z', live: true, ...extra })
const state = (extra: Partial<SiteState> = {}): SiteState => ({ live: null, releases: [], sites: [site], ...extra })
/** Answers the page's requests: the site state, imports, and whatever `more` adds. */
function serve(current: () => SiteState, more: (path: string, method?: string, body?: unknown) => unknown = () => undefined, imports: () => SiteImport[] = () => []) {
  mocked.mockImplementation(async (path, method, body) => more(path, method, body) ?? (path === '/webmaster/site' ? current() : path === '/webmaster/imports' ? imports() : {}))
}
beforeEach(() => { mocked.mockReset(); vi.mocked(uploadFile).mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('puts the websites first, with bringing one in, Tools and Help folded away', async () => {
  serve(() => state(), path => path === '/webmaster/previews' ? { url: '/api/community/preview/tok/' } : undefined)
  const { container } = render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={vi.fn()} />)
  const tile = (await screen.findByText('roguefest-site')).closest('li')!
  for (const action of [/Preview & notes/, /Open editor/, /Publish/]) expect(within(tile).getByRole('button', { name: action })).toBeInTheDocument()
  // The site, pictured as visitors see it, with no drafts and none of the preview pane's pins.
  expect(await within(tile).findByTitle('roguefest-site, as visitors see it')).toHaveAttribute('src', '/api/community/preview/tok/')
  expect(mocked).toHaveBeenCalledWith('/webmaster/previews', 'POST', { space_id: 'web', folder: 'Website/roguefest-site', bridge: false, drafts: false })
  for (const fold of ['Bring in a website', 'Tools', 'Help']) expect(screen.getByRole('heading', { name: fold })).toBeInTheDocument()
  for (const way of ['From its address', 'From a .zip', 'Make a one-page site']) expect(screen.getByRole('heading', { name: way })).toBeInTheDocument()
  // With a site to work on, bringing one in is folded away; it opens with its arrow.
  const folds = [...container.querySelectorAll('details.fold')] as HTMLDetailsElement[]
  expect(folds.map(d => d.open)).toEqual([false, false, false])
  expect(screen.getByLabelText('Keep it in')).toHaveValue('crew')
  expect(screen.getByText('Nothing is published yet. Visitors to localhost:3000 go to the members’ page.')).toBeInTheDocument()
  expect(screen.queryByText(/Workers Scripts/)).toBeNull()
})

it('opens bringing a site in, and Tools, while there is no website yet', async () => {
  serve(() => state({ sites: [] }))
  const { container } = render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={vi.fn()} />)
  expect(await screen.findByText(/No websites yet/)).toBeInTheDocument()
  expect(([...container.querySelectorAll('details.fold')] as HTMLDetailsElement[]).map(d => d.open)).toEqual([true, true, false])
})

it('starts an import into the chosen space and shows what came in', async () => {
  let list: SiteImport[] = []
  serve(() => state(), (path, method) => path === '/webmaster/imports' && method === 'POST' ? (list = [job({ status: 'running', added: 3 })], list[0]) : undefined, () => list)
  render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Website address'), { target: { value: 'roguefestfilmfestival.com' } })
  fireEvent.change(screen.getByLabelText('Keep it in'), { target: { value: 'web' } })
  fireEvent.click(screen.getByRole('button', { name: /Import website/ }))
  expect(await screen.findByText('Importing… 3 files so far')).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/webmaster/imports', 'POST', { url: 'roguefestfilmfestival.com', space_id: 'web' })
  expect(screen.getByRole('button', { name: /Importing/ })).toBeDisabled()
  list = [job()]
  expect(await screen.findByText('20 new files, 0 changed, 0 the same · 6.0 MB', {}, { timeout: 4000 })).toBeInTheDocument()
  expect(screen.getByText('Left where they are, on other sites: player.vimeo.com, filmfreeway.com')).toBeInTheDocument()
})

it('opens an imported site in Files, and says why an import failed', async () => {
  const onOpen = vi.fn()
  serve(() => state({ sites: [] }), undefined, () => [job(), job({ id: 'i0', status: 'failed', message: 'intranet.local is not a public address.' })])
  render(<Webmaster user={owner} spaces={spaces} onOpen={onOpen} />)
  fireEvent.click(await screen.findByRole('button', { name: /Open in Files/ }))
  expect(onOpen).toHaveBeenCalledWith('web', 'Website/roguefestfilmfestival.com')
  expect(screen.getByRole('alert')).toHaveTextContent('intranet.local is not a public address.')
  await waitFor(() => expect(screen.getByText('1 file not brought in')).toBeInTheDocument())
})

it('uploads a .zip into Website, as a new version when it was sent before, and unpacks it', async () => {
  serve(() => state(), (path, method) => path.startsWith('/community/spaces/crew/files') ? { folder: 'Website', items: [{ id: 'zip1', kind: 'file', name: 'roguefest-site.zip' }] }
    : path === '/webmaster/unpack' ? { space_id: 'crew', folder: 'Website/roguefest-site', added: 70, changed: 2, unchanged: 3, skipped: 1, bytes: 1800000,
      skipped_files: [['shortcut', 'it is a link, not a file']], message: '', has_index: true } : method === 'POST' && path.endsWith('/folders') ? {} : undefined)
  vi.mocked(uploadFile).mockResolvedValue({ id: 'zip1' } as FileItem)
  const onOpen = vi.fn()
  render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={onOpen} />)
  const zip = new File(['PK'], 'roguefest-site.zip', { type: 'application/zip' })
  fireEvent.change(screen.getByLabelText('Website .zip'), { target: { files: [zip] } })
  // jsdom can't see a file a test puts in a required input, so the form is sent as the browser would once it's chosen.
  fireEvent.submit(screen.getByRole('button', { name: /Upload and unpack/ }).closest('form')!)
  expect(await screen.findByText(/70 new files, 2 changed, 3 the same/)).toBeInTheDocument()
  expect(uploadFile).toHaveBeenCalledWith('crew', zip, { folder: 'Website', replaces: 'zip1' })
  expect(mocked).toHaveBeenCalledWith('/webmaster/unpack', 'POST', { space_id: 'crew', file_id: 'zip1' })
  expect(screen.getByText('1 file left out')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: /Open in Files/ })[0])
  expect(onOpen).toHaveBeenCalledWith('crew', 'Website/roguefest-site')
})

it('makes a one-page starter site, or says where it already is, right by the button', async () => {
  let existed = false
  serve(() => state(), path => path === '/webmaster/starter' ? { space_id: 'crew', folder: 'Website/roguefest.arynwood.com', existed } : undefined)
  const onShow = vi.fn()
  render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={vi.fn()} onShow={onShow} />)
  const tool = screen.getByRole('heading', { name: 'Make a one-page site' }).parentElement!
  fireEvent.click(within(tool).getByRole('button', { name: /Make a one-page site/ }))
  expect(await within(tool).findByText(/Your one-page site is in Website\/roguefest.arynwood.com\./)).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/webmaster/starter', 'POST', { space_id: 'crew' })
  fireEvent.click(within(tool).getByRole('button', { name: /Open editor/ }))
  expect(onShow).toHaveBeenCalledWith({ space: 'crew', folder: 'Website/roguefest.arynwood.com', mode: 'edit' })
  existed = true
  fireEvent.click(within(tool).getByRole('button', { name: /Make a one-page site/ }))
  expect(await within(tool).findByText(/Your one-page site is already in Website\/roguefest.arynwood.com, just as it was\./)).toBeInTheDocument()
})

it('publishes after asking, then puts an earlier version back or takes the site down', async () => {
  let current = state()
  serve(() => current, (path, method) => {
    if (path === '/webmaster/publish') { current = state({ live: release({ id: 'r2', created: '2026-10-16T11:00:00Z' }), releases: [release({ id: 'r2', created: '2026-10-16T11:00:00Z' }), release({ live: false })] }); return { ...current.live, hidden: ['_headers'] } }
    if (path === '/webmaster/releases/r1/live') { current = state({ live: release(), releases: [release({ id: 'r2', live: false }), release()] }); return current.live }
    if (path === '/webmaster/live' && method === 'DELETE') { current = state({ releases: current.releases.map(r => ({ ...r, live: false })) }); return { ok: true } }
  })
  render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Publish/ }))
  const ask = screen.getByRole('dialog')
  expect(ask).toHaveTextContent('Visitors to localhost:3000 see it straight away')
  fireEvent.click(within(ask).getByRole('button', { name: /Publish/ }))
  expect(await screen.findByText(/roguefest-site is live at localhost:3000. The Grove keeps these addresses for itself, so they aren’t shown: _headers./)).toBeInTheDocument()
  expect(mocked).toHaveBeenCalledWith('/webmaster/publish', 'POST', { space_id: 'web', folder: 'Website/roguefest-site' })
  // The Grove's own address, opened in the system browser.
  expect(await screen.findByRole('link', { name: 'Visit the site' })).toHaveAttribute('href', 'http://localhost:3000/')
  fireEvent.click(screen.getByText('Earlier versions (1)'))
  fireEvent.click(screen.getByRole('button', { name: 'Put this back' }))
  expect(await screen.findByText(/is live again/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Take it down' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take it down' }))
  expect(await screen.findByText('The website is down. Visitors to localhost:3000 go to the members’ page.')).toBeInTheDocument()
})

it('lets every member preview and leave notes, but not change or publish', async () => {
  serve(() => state({ live: release(), sites: [site, { ...site, space_id: 'other', space_name: 'Board', member: false, folder: 'Website/draft', name: 'draft', notes: 2 }] }))
  const onShow = vi.fn()
  render(<Webmaster user={member} spaces={spaces} current="crew" onOpen={vi.fn()} onShow={onShow} />)
  expect(screen.getByRole('heading', { name: 'Website' })).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'Visit the site' })).toBeInTheDocument()
  for (const hidden of [/Bring in a website/, /Tools/, /Publish/, /Take it down/, /Import website/, /Open editor/]) expect(screen.queryByRole('button', { name: hidden }) ?? screen.queryByRole('heading', { name: hidden })).toBeNull()
  expect(screen.getAllByRole('button', { name: /Open in Files/ })).toHaveLength(1)
  expect(screen.getByText(/Board · 75 files, 1.7 MB .* · 2 open notes/)).toBeInTheDocument()
  expect(mocked).not.toHaveBeenCalledWith('/webmaster/imports')
  fireEvent.click(screen.getAllByRole('button', { name: /Preview & notes/ })[1])
  expect(onShow).toHaveBeenCalledWith({ space: 'other', folder: 'Website/draft', mode: 'review' })
})

it('opens a site in the editor for webmasters', async () => {
  serve(() => state())
  const onShow = vi.fn()
  render(<Webmaster user={owner} spaces={spaces} current="crew" onOpen={vi.fn()} onShow={onShow} />)
  fireEvent.click(await screen.findByRole('button', { name: /Open editor/ }))
  expect(onShow).toHaveBeenCalledWith({ space: 'web', folder: 'Website/roguefest-site', mode: 'edit' })
  fireEvent.click(screen.getByRole('button', { name: /Preview & notes/ }))
  expect(onShow).toHaveBeenLastCalledWith({ space: 'web', folder: 'Website/roguefest-site', mode: 'review' })
})

it('uses the spaces once they arrive, even if the page opened before them', async () => {
  serve(() => state(), path => path === '/webmaster/starter' ? { space_id: 'crew', folder: 'Website/home' } : undefined)
  const { rerender } = render(<Webmaster user={owner} spaces={[]} onOpen={vi.fn()} />)
  expect(screen.getByRole('button', { name: /Make a one-page site/ })).toBeDisabled()
  rerender(<Webmaster user={owner} spaces={spaces} onOpen={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Make a one-page site/ }))
  await screen.findByText(/Your one-page site is in Website\/home/)
  expect(mocked).toHaveBeenCalledWith('/webmaster/starter', 'POST', { space_id: 'crew' })
})

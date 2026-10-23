import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleHelp, Code, Eye, FileArchive, FolderOpen, Globe, LoaderCircle, Rocket, Sparkles, Wrench } from 'lucide-react'
import { api, stamp, type Space, type User } from '../lib/community'
import { GroveContext, openOutside, previewUrl } from '../lib/grove'
import { bytes, uploadFile, type Listing } from '../lib/files'
import type { SiteTarget } from '../lib/site'
import { Modal } from './Workspace'
import './webmaster.css'
// The site editor (with CodeMirror) and the preview load when they're opened.
const SiteStudio = lazy(() => import('./SiteStudio').then(module => ({ default: module.SiteStudio })))
const SiteReview = lazy(() => import('./SiteReview').then(module => ({ default: module.SiteReview })))

export interface SiteImport {
  id: string; space_id: string; space_name: string; url: string; folder: string; status: 'running' | 'done' | 'failed'
  added: number; changed: number; unchanged: number; skipped: number; bytes: number; message: string; started: string; finished: string | null
  notes: { elsewhere?: string[]; skipped?: [string, string][]; server?: string; cloudflare_analytics?: boolean }
}
/** A folder in a space's Website folder with an index.html at its top. */
export interface Site { space_id: string; space_name: string; folder: string; name: string; member: boolean; files: number; bytes: number; updated: string; notes: number }
/** A website as it was published. */
export interface Release { id: string; space_id: string; space_name: string; folder: string; files: number; bytes: number; user_name: string; created: string; live: boolean; hidden?: string[] }
export interface SiteState { live: Release | null; releases: Release[]; sites: Site[] }
interface Unpacked { space_id: string; folder: string; added: number; changed: number; unchanged: number; skipped: number; bytes: number; skipped_files: [string, string][]; message: string; has_index: boolean }
const count = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const host = (url: string) => { try { return new URL(url).host } catch { return url } }

/** The Grove's website. Everyone sees what's live, previews what's coming and leaves notes on it;
 *  owners and webmasters bring a site in, change it in the site editor, and publish it at the
 *  Grove's address. `open` is a site shown in the editor or its preview, from the page's address. */
export function Webmaster({ user, spaces, current, onOpen, open, onShow = () => {} }: {
  user: User; spaces: Space[]; current?: string; onOpen: (spaceId: string, folder: string) => void; open?: SiteTarget | null; onShow?: (target: SiteTarget | null) => void
}) {
  if (open) {
    const review = () => onShow({ ...open, mode: 'review' }), edit = () => onShow({ ...open, mode: 'edit' })
    return <Suspense fallback={<div className="workspace"><p>Opening…</p></div>}>{open.mode === 'edit' && user.webmaster
      ? <SiteStudio key={open.space + open.folder} user={user} target={open} onBack={() => onShow(null)} onReview={review} onFiles={() => onOpen(open.space, open.folder)} />
      : <SiteReview key={open.space + open.folder} user={user} target={open} onBack={() => onShow(null)} onEdit={user.webmaster && spaces.some(s => s.id === open.space) ? edit : undefined} />}</Suspense>
  }
  return <SiteTools user={user} spaces={spaces} current={current} onOpen={onOpen} onShow={onShow} />
}

function SiteTools({ user, spaces, current, onOpen, onShow }: { user: User; spaces: Space[]; current?: string; onOpen: (spaceId: string, folder: string) => void; onShow: (target: SiteTarget) => void }) {
  const grove = useContext(GroveContext)
  const editor = !!user.webmaster, address = new URL(grove.url).host
  const [state, setState] = useState<SiteState | null>(null), [imports, setImports] = useState<SiteImport[] | null>(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(''), [reload, setReload] = useState(0)
  // Spaces may arrive after the page opens: until one is chosen, it's the current one, or the first.
  const [chosen, setSpace] = useState(''), [unpacked, setUnpacked] = useState<Unpacked | null>(null)
  const space = spaces.some(s => s.id === chosen) ? chosen : current ?? spaces[0]?.id ?? ''
  const [publishing, setPublishing] = useState<Site | null>(null), [takingDown, setTakingDown] = useState(false)
  // Whether Bring in a website and Tools are open, once someone opens or closes them.
  const [bringing, setBringing] = useState<boolean | null>(null), [tooling, setTooling] = useState<boolean | null>(null)
  // The one-page site, once asked for; and which tool an error came from, so it shows beside that tool.
  const [made, setMade] = useState<{ space_id: string; folder: string; existed: boolean } | null>(null), [errorAt, setErrorAt] = useState('')
  const running = imports?.some(i => i.status === 'running') ?? false
  const flash = (text: string) => { setMessage(text); setError('') }
  const fail = (e: unknown, at = '') => { setError((e as Error).message); setErrorAt(at); setMessage('') }
  useEffect(() => {
    let active = true
    api<SiteState>('/webmaster/site').then(value => { if (active) setState(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [reload])
  useEffect(() => {
    if (!editor) return
    let active = true
    const load = () => api<SiteImport[]>('/webmaster/imports').then(list => { if (active) setImports(list) }).catch(e => { if (active) setError(e.message) })
    void load()
    // While an import runs, its progress shows as it goes; once it ends, its site is listed.
    const timer = running ? setInterval(() => void load(), 1500) : undefined
    return () => { active = false; clearInterval(timer); if (running) setReload(n => n + 1) }
  }, [running, editor])
  async function act(name: string, work: () => Promise<unknown>) {
    setBusy(name); setError('')
    try { await work() } catch (e) { fail(e, name) } finally { setBusy('') }
  }
  const startImport = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const url = String(new FormData(event.currentTarget).get('url') ?? ''); setBringing(true); void act('import', async () => {
    const started = await api<SiteImport>('/webmaster/imports', 'POST', { url, space_id: space }); setImports(list => [started, ...(list ?? [])])
  }) }
  const sendZip = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget, file = (form.elements.namedItem('zip') as HTMLInputElement).files?.[0]; setBringing(true); void act('zip', async () => {
    if (!file || !/\.zip$/i.test(file.name)) throw new Error('Choose a .zip file.')
    await api(`/community/spaces/${space}/folders`, 'POST', { folder: '', name: 'Website' }).catch(() => {}) // already there
    const listing = await api<Listing>(`/community/spaces/${space}/files?` + new URLSearchParams({ folder: 'Website' }))
    const earlier = listing.items.find(i => i.kind === 'file' && i.name === file.name)
    const saved = await uploadFile(space, file, { folder: 'Website', replaces: earlier?.id })
    setUnpacked(await api<Unpacked>('/webmaster/unpack', 'POST', { space_id: space, file_id: saved.id })); form.reset(); setMessage(''); setReload(n => n + 1)
  }) }
  const startPage = () => { setTooling(true); setMade(null); void act('starter', async () => {
    setMade(await api<{ space_id: string; folder: string; existed: boolean }>('/webmaster/starter', 'POST', { space_id: space })); setReload(n => n + 1)
  }) }
  const show = (site: Site, mode: SiteTarget['mode']) => onShow({ space: site.space_id, folder: site.folder, mode })
  const publish = (site: Site) => { setPublishing(null); void act('publish', async () => {
    const release = await api<Release>('/webmaster/publish', 'POST', { space_id: site.space_id, folder: site.folder })
    flash(`${site.name} is live at ${address}.` + (release.hidden?.length ? ` The Grove keeps these addresses for itself, so they aren’t shown: ${release.hidden.join(', ')}.` : '')); setReload(n => n + 1)
  }) }
  const putBack = (release: Release) => void act('release:' + release.id, async () => {
    await api(`/webmaster/releases/${release.id}/live`, 'POST'); flash(`The version published ${stamp(release.created)} is live again.`); setReload(n => n + 1)
  })
  const takeDown = () => { setTakingDown(false); void act('down', async () => {
    await api('/webmaster/live', 'DELETE'); flash(`The website is down. Visitors to ${address} go to the members’ page.`); setReload(n => n + 1)
  }) }

  const live = state?.live, sites = state?.sites ?? []
  // A site is brought in once: this folds away when there's a site to work on, unless someone opens it.
  const bringOpen = bringing ?? (!!state && !sites.length), toolsOpen = tooling ?? (!!state && !sites.length)
  // Errors from bringing a site in or from a tool show beside it; the rest, here at the top.
  const inline = ['import', 'zip', 'starter'].includes(errorAt)
  const where = <label className="keep-in">Keep it in<select value={space} onChange={e => setSpace(e.target.value)}>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
  const isLive = (site: Site) => !!live && live.space_id === site.space_id && live.folder === site.folder
  return <div className="workspace webmaster">
    <div className="page-heading"><div><span className="eyebrow">This Grove</span><h1>{editor ? 'Webmaster tools' : 'Website'}</h1>
      <p>{editor ? `Preview your website, change it together, and publish it at ${address}.` : `This Grove’s website, and what its webmasters are working on. Preview it before it’s published, and leave notes on anything that should change.`}</p></div></div>
    {error && !inline && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}

    <section className="site-section" aria-labelledby="sites-heading">
      <h2 id="sites-heading">{editor ? 'Your websites' : 'Preview and notes'}</h2>
      {!state ? <p>Loading…</p> : sites.length ? <ul className="site-tiles">{sites.map(site => <SiteTile key={site.space_id + site.folder} site={site} live={isLive(site)} editor={editor} busy={busy} onShow={show} onPublish={setPublishing} onOpen={onOpen} />)}</ul>
        : <p className="muted-text">{editor ? 'No websites yet. Bring yours in below, from its address or a .zip, or make a one-page site in Tools.' : 'There’s no website to preview yet.'}</p>}
    </section>

    <section className="panel live-site" aria-labelledby="live-heading">
      <h2 id="live-heading"><Globe size={18} aria-hidden="true" /> Live at {address}</h2>
      {!state ? <p>Loading…</p> : live ? <>
        <p><strong>{live.folder}</strong>{live.space_name ? ` from ${live.space_name}` : ''}, published {stamp(live.created)}{live.user_name ? ` by ${live.user_name}` : ''} · {count(live.files, 'file')}, {bytes(live.bytes)}</p>
        <div className="action-row"><a className="primary button-link" href={grove.url + '/'} target="_blank" rel="noopener noreferrer" onClick={openOutside}>Visit the site</a>
          {editor && <button className="secondary" disabled={!!busy} onClick={() => setTakingDown(true)}>Take it down</button>}</div>
      </> : <p>Nothing is published yet. Visitors to {address} go to the members’ page.</p>}
      {editor && state && state.releases.length > 1 && <details><summary>Earlier versions ({state.releases.length - 1})</summary><ul className="release-list">
        {state.releases.filter(r => !r.live).map(r => <li key={r.id}><span>{r.folder}, published {stamp(r.created)}{r.user_name ? ` by ${r.user_name}` : ''} · {count(r.files, 'file')}</span>
          <button className="secondary" disabled={!!busy} onClick={() => putBack(r)}>Put this back</button></li>)}
      </ul></details>}
    </section>

    {editor && <details className="panel fold" open={bringOpen} onToggle={e => setBringing(e.currentTarget.open)}>
      <summary><h2>Bring in a website</h2>{running && <span className="pill">Importing…</span>}<ChevronDown size={20} className="fold-chevron" aria-hidden="true" /></summary>
      <div className="fold-body">
        <p>Your site’s files go in a space’s <strong>Website</strong> folder. Everyone in that space can see them, and everyone in the Grove can preview the site. Only owners and webmasters change them. You only need to do this once: after that, change the site in the editor.</p>
        {spaces.length ? where : <p className="muted-text">Join or start a space to keep your website in.</p>}
        <div className="bring-in">
          <form onSubmit={startImport}>
            <h3>From its address</h3>
            <p>The Grove reads your site the way a visitor’s browser does: the first page, every page it links to on the same address, and the styles, scripts, images and fonts they use. It follows your site’s robots.txt, and never reads other sites.</p>
            <label>Website address<input name="url" required maxLength={2000} placeholder="https://example.com" defaultValue={imports?.[0]?.url ?? ''} key={imports?.[0]?.url ?? ''} /></label>
            <div className="action-row"><button className="primary" disabled={!!busy || running || !space}><Globe size={15} /> {running ? 'Importing…' : 'Import website'}</button></div>
          </form>
          <form onSubmit={sendZip}>
            <h3>From a .zip</h3>
            <p>For a site that isn’t online yet, or one your designer sent you. Zip the folder that holds its <code>index.html</code>. Sending the same .zip again updates what changed.</p>
            <label>Website .zip<input name="zip" type="file" accept=".zip,application/zip" required /></label>
            <div className="action-row"><button className="primary" disabled={!!busy || !space}><FileArchive size={15} /> {busy === 'zip' ? 'Unpacking…' : 'Upload and unpack'}</button></div>
          </form>
        </div>
        {error && (errorAt === 'import' || errorAt === 'zip') && <p className="error" role="alert">{error}</p>}
        {unpacked && <div className="import-result">
          <p><strong>{unpacked.folder}</strong>: {count(unpacked.added, 'new file')}, {unpacked.changed} changed, {unpacked.unchanged} the same · {bytes(unpacked.bytes)}</p>
          {unpacked.message && <p className="muted-text">{unpacked.message}</p>}
          {!unpacked.has_index && <p className="danger">There’s no index.html at the top of the .zip’s folder, so the site has no front page yet.</p>}
          {!!unpacked.skipped_files.length && <details><summary>{count(unpacked.skipped, 'file')} left out</summary><ul>{unpacked.skipped_files.map(([path, reason]) => <li key={path}><code>{path}</code>: {reason}</li>)}</ul></details>}
          <button className="secondary" onClick={() => onOpen(unpacked.space_id, unpacked.folder)}><FolderOpen size={15} /> Open in Files</button>
        </div>}
        {imports?.map(i => <ImportResult key={i.id} job={i} onOpen={onOpen} />)}
        <details><summary>What an import can’t bring</summary><ul>
          <li>Code that runs on a server, such as what a form sends to, or a shop’s checkout.</li>
          <li>Pages only signed-in visitors see, and pages nothing links to.</li>
          <li>Files kept on other sites, such as a video on Vimeo. They stay where they are, and the import lists them.</li>
        </ul></details>
      </div>
    </details>}

    {editor && <details className="panel fold" open={toolsOpen} onToggle={e => setTooling(e.currentTarget.open)}>
      <summary><h2><Wrench size={18} aria-hidden="true" /> Tools</h2><ChevronDown size={20} className="fold-chevron" aria-hidden="true" /></summary>
      <div className="fold-body tools">
        <div>
          <h3>Make a one-page site</h3>
          <p>A front page made from this Grove’s name, tagline and colours, with a way in for members. A good start when there’s no website yet. Change anything before you publish it.</p>
          {spaces.length > 1 && <label className="keep-in">Make it in<select value={space} onChange={e => setSpace(e.target.value)}>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <div className="action-row"><button className="secondary" disabled={!!busy || !space} onClick={startPage}><Sparkles size={15} /> {busy === 'starter' ? 'Making…' : 'Make a one-page site'}</button></div>
          {error && errorAt === 'starter' && <p className="error" role="alert">{error}</p>}
          {made && <div className="import-result" role="status">
            <p>{made.existed ? `Your one-page site is already in ${made.folder}, just as it was.` : `Your one-page site is in ${made.folder}.`} Open it in the editor to change it, and publish it when it’s ready.</p>
            <div className="action-row"><button className="primary" onClick={() => onShow({ space: made.space_id, folder: made.folder, mode: 'edit' })}><Code size={15} /> Open editor</button>
              <button className="secondary" onClick={() => onShow({ space: made.space_id, folder: made.folder, mode: 'review' })}><Eye size={15} /> Preview & notes</button></div>
          </div>}
        </div>
        <div>
          <h3>The Website folder</h3>
          <p>Every site’s files are kept in a space’s Website folder in Files, with their earlier versions and the trash.</p>
          <div className="action-row"><button className="secondary" disabled={!space} onClick={() => onOpen(space, 'Website')}><FolderOpen size={15} /> Open Website in Files</button></div>
        </div>
      </div>
    </details>}

    <details className="panel fold">
      <summary><h2><CircleHelp size={18} aria-hidden="true" /> Help</h2><ChevronDown size={20} className="fold-chevron" aria-hidden="true" /></summary>
      <div className="fold-body">
        <h3>Preview & notes</h3>
        <p>Everyone in the Grove can open <strong>Preview & notes</strong>: the whole site as visitors will see it, at computer, tablet and phone sizes. Choose <strong>Add a note</strong> and click anything that should change, such as a date, a picture or some wording, and suggest the new wording if you like. {editor ? 'Notes show up in the editor as they’re left, where you can use the suggested wording, reply, and mark them done.' : 'Only this Grove’s owners, and the webmasters they choose, change and publish its website. They see your notes straight away.'}</p>
        {editor && <>
          <h3>The editor</h3>
          <ul>
            <li>Choose <strong>Open editor</strong>: the site’s files, its code and a preview, side by side. Every page, stylesheet, script and picture is there, laid out as on your domain.</li>
            <li>The preview follows what you type, on every page, before you save. Your changes are kept as a draft as you go, so nothing is lost if the page closes. Only you see them until you save.</li>
            <li>Click the target in the preview, then anything on the page, to find it in the code. Add pages, folders and pictures from the file list.</li>
            <li>Save makes a new version; earlier versions stay in Files. Nothing you change is live until you publish it.</li>
          </ul>
          <h3>Publishing</h3>
          <p>Publishing puts the saved site at {address} straight away; the members’ page stays at {address}/community. An earlier version can be put back from <strong>Live at {address}</strong>.</p>
          <h3>Your own domain, or another host</h3>
          <ul>
            <li>To show your site at your own domain, ask this Grove’s host to move the Grove there. Your site and the members’ page move together.</li>
            <li>To publish it somewhere else, use <strong>Download as a .zip</strong> on the site’s folder in Files, and send it to whoever runs that host.</li>
            <li>Published pages run their scripts apart from the Grove: they can’t see members’ sign-ins, cookies or browser storage.</li>
          </ul>
        </>}
      </div>
    </details>

    {publishing && <Modal title={`Publish ${publishing.name}?`} onClose={() => setPublishing(null)}>
      <p>Visitors to {address} see it straight away{live ? ', in place of what’s live now. You can put that back afterwards' : ''}.</p>
      <div className="action-row"><button className="primary" onClick={() => publish(publishing)}><Rocket size={15} /> Publish</button><button className="secondary" onClick={() => setPublishing(null)}>Cancel</button></div>
    </Modal>}
    {takingDown && <Modal title="Take the website down?" onClose={() => setTakingDown(false)}>
      <p>Visitors to {address} go to the members’ page instead. You can put this version back from Earlier versions.</p>
      <div className="action-row"><button className="danger-button" onClick={takeDown}>Take it down</button><button className="secondary" onClick={() => setTakingDown(false)}>Cancel</button></div>
    </Modal>}
  </div>
}

// The width a site is pictured at: a computer's, scaled down to the tile.
const WIDE = 1280

/** A website, pictured as visitors see it, with what can be done with it. */
function SiteTile({ site, live, editor, busy, onShow, onPublish, onOpen }: { site: Site; live: boolean; editor: boolean; busy: string; onShow: (site: Site, mode: SiteTarget['mode']) => void; onPublish: (site: Site) => void; onOpen: (spaceId: string, folder: string) => void }) {
  const works = editor && site.member
  return <li className="panel site-tile">
    <Glimpse site={site} onClick={() => onShow(site, 'review')} />
    <div className="site-tile-body">
      <span className="who"><strong>{site.name}{live && <span className="pill">Live</span>}</strong><small>{site.space_name} · {count(site.files, 'file')}, {bytes(site.bytes)}{site.updated ? ` · changed ${stamp(site.updated)}` : ''}{site.notes ? ` · ${count(site.notes, 'open note')}` : ''}</small></span>
      <span className="action-row">
        <button className={works ? 'secondary' : 'primary'} onClick={() => onShow(site, 'review')}><Eye size={15} /> Preview & notes</button>
        {works && <button className="primary" onClick={() => onShow(site, 'edit')}><Code size={15} /> Open editor</button>}
        {!editor && site.member && <button className="secondary" onClick={() => onOpen(site.space_id, site.folder)}><FolderOpen size={15} /> Open in Files</button>}
        {works && <button className="secondary" disabled={!!busy} onClick={() => onPublish(site)}><Rocket size={15} /> Publish</button>}
      </span>
    </div>
  </li>
}

/** The site's front page, live and scaled down. A picture only: the buttons beside it are the way in. */
function Glimpse({ site, onClick }: { site: Site; onClick: () => void }) {
  const [url, setUrl] = useState(''), [scale, setScale] = useState(0.3), box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true
    api<{ url: string }>('/webmaster/previews', 'POST', { space_id: site.space_id, folder: site.folder, bridge: false, drafts: false }).then(r => { if (active && r?.url) setUrl(r.url) }).catch(() => {})
    return () => { active = false }
  }, [site.space_id, site.folder, site.updated])
  useEffect(() => {
    const frame = box.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / WIDE))
    watch.observe(frame)
    return () => watch.disconnect()
  }, [])
  return <div ref={box} className="site-glimpse" aria-hidden="true" onClick={onClick}>
    {url && <iframe src={previewUrl(url)} title={`${site.name}, as visitors see it`} tabIndex={-1} sandbox="allow-scripts" loading="lazy" scrolling="no" style={{ transform: `scale(${scale})` }} />}
  </div>
}

function ImportResult({ job, onOpen }: { job: SiteImport; onOpen: (spaceId: string, folder: string) => void }) {
  return <div className={'import-result import-' + job.status}>
    <p><strong>{host(job.url)}</strong> into {job.space_name || 'a space that was deleted'} · {stamp(job.started)}</p>
    {job.status === 'running' ? <p role="status"><LoaderCircle size={15} className="spinning" aria-hidden="true" /> Importing… {count(job.added + job.changed + job.unchanged, 'file')} so far</p>
      : job.status === 'failed' ? <p className="danger" role="alert">{job.message || 'The import failed.'}</p> : <>
        <p>{count(job.added, 'new file')}, {job.changed} changed, {job.unchanged} the same · {bytes(job.bytes)}</p>
        {job.message && <p className="muted-text">{job.message}</p>}
        {!!job.notes.elsewhere?.length && <p className="muted-text">Left where they are, on other sites: {job.notes.elsewhere.join(', ')}</p>}
        {job.notes.cloudflare_analytics && <p className="muted-text">Cloudflare’s analytics script was left out of the pages. Cloudflare adds it to each page as it serves it, so keeping it would count every visit twice.</p>}
        {!!job.notes.skipped?.length && <details><summary>{count(job.skipped, 'file')} not brought in</summary><ul>{job.notes.skipped.map(([path, reason]) => <li key={path}><code>{path}</code>: {reason}</li>)}</ul></details>}
        {job.space_name && <button className="secondary" onClick={() => onOpen(job.space_id, job.folder)}><FolderOpen size={15} /> Open in Files</button>}
      </>}
  </div>
}

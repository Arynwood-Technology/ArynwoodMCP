import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search'
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Crosshair, Download, ExternalLink, Eye, File as FileIcon, FilePlus, FileText, Folder, FolderPlus,
  Image as ImageIcon, MessageSquare, MessageSquarePlus, RefreshCw, Rocket, Save, Upload, X } from 'lucide-react'
import { api, stamp, type User } from '../lib/community'
import { GroveContext, groveUrl, openOutside, saveLink } from '../lib/grove'
import { colours, language, theme } from '../lib/codemirror'
import { contentUrl, isImage, isText, joined, readText, saveText, uploadFile } from '../lib/files'
import { useLiveRefresh } from '../lib/live'
import { asHtml, findQuote, pageAddress, pageFile, pinsFor, siteApi, type Device, type SiteFile, type SiteNote, type SiteReview, type SiteTarget, type Spot } from '../lib/site'
import { PreviewFrame, type PreviewHandle } from '../components/PreviewFrame'
import { NoteComposer, NotesPanel, PreviewBar } from '../components/SiteNotes'
import { Modal } from './Workspace'
import type { Release } from './Webmaster'
import './site.css'

const TEXT_MAX = 2 * 1024 * 1024
const RENEW_MS = 50 * 60 * 1000
const KEEP_MS = 450 // how long typing pauses before the draft is kept and the preview catches up
/** A file open in the editor: what's saved, what version it started from, and its editor state. */
interface Open { path: string; item: SiteFile; text: boolean; saved: string; version: number; state: EditorState | null; drafted: boolean; stale: boolean }
const relative = (folder: string, item: SiteFile) => joined(item.folder, item.name).slice(folder.length + 1)
const titled = (name: string) => { const stem = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(); return stem ? stem[0].toUpperCase() + stem.slice(1) : 'New page' }
const blank = (name: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${asHtml(titled(name))}</title>
</head>
<body>
  <h1>${asHtml(titled(name))}</h1>
</body>
</html>
`

/** The site editor: a website's files, its code and a live preview side by side, for its owners and
 *  webmasters. What they type is kept as a draft as they go, so their preview shows it at once and
 *  nothing is lost if the page closes; saving makes it the site's, for everyone's previews. Notes
 *  people leave on the preview are here too, with a way to find what they point at in the code. */
export function SiteStudio({ user, target, onBack, onReview, onFiles }: { user: User; target: SiteTarget; onBack: () => void; onReview: () => void; onFiles: () => void }) {
  const grove = useContext(GroveContext)
  const { space, folder } = target, address = new URL(grove.url).host
  const rel = (item: SiteFile) => relative(folder, item)
  const [tree, setTree] = useState<SiteFile[] | null>(null), [review, setReview] = useState<SiteReview | null>(null), [url, setUrl] = useState('')
  const [tabs, setTabs] = useState<string[]>([]), [active, setActive] = useState('')
  // Files opened so far, as the page shows them; their text and editor state are in `docs`.
  const [loaded, setLoaded] = useState<Map<string, { item: SiteFile; text: boolean }>>(new Map())
  const [dirty, setDirty] = useState<Set<string>>(new Set()), [stale, setStale] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set()), [place, setPlace] = useState('')
  const [side, setSide] = useState<'files' | 'notes'>('files'), [pane, setPane] = useState<'files' | 'code' | 'preview'>('code')
  const [device, setDevice] = useState<Device>('computer'), [here, setHere] = useState('/'), [picking, setPicking] = useState<'' | 'code' | 'note'>('')
  const [spot, setSpot] = useState<Spot | null>(null), [selected, setSelected] = useState(''), [following, setFollowing] = useState(true)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState('')
  const [naming, setNaming] = useState<'file' | 'folder' | null>(null), [namingError, setNamingError] = useState(''), [publishing, setPublishing] = useState(false)
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null), frame = useRef<PreviewHandle>(null), picker = useRef<HTMLInputElement>(null)
  const docs = useRef(new Map<string, Open>()), shown = useRef(''), files = useRef<SiteFile[]>([]), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const chains = useRef(new Map<string, Promise<void>>()), live = useRef(true), changed = useRef('')
  const actions = useRef({ changed: (path: string) => { void path }, save: () => {}, open: (path: string) => { void path } })
  const flash = (text: string) => { setMessage(text); setError('') }
  const fail = (e: unknown) => { setError((e as Error).message); setMessage('') }
  const mark = (setter: typeof setDirty, path: string, on: boolean) => setter(set => set.has(path) === on ? set : (on ? new Set(set).add(path) : new Set([...set].filter(p => p !== path))))
  const textOf = (path: string) => (path === shown.current && editor.current ? editor.current.state : docs.current.get(path)?.state)?.doc.toString() ?? ''

  // Loading: the site's files (with this webmaster's drafts), its notes, and a preview with the drafts in it.
  const loadTree = async () => { const { items } = await siteApi.files(space, folder); files.current = items; setTree(items); return items }
  const loadReview = useRef(async () => {})
  useEffect(() => {
    let active = true
    loadReview.current = async () => {
      try {
        const next = await siteApi.review(space, folder)
        if (!active) return
        if (changed.current && next.changed !== changed.current) frame.current?.reload()
        changed.current = next.changed; setReview(next)
      } catch (e) { if (active) fail(e) }
    }
    const renew = () => siteApi.preview(space, folder, true).then(v => { if (active) setUrl(v.url) }).catch(e => { if (active) fail(e) })
    void loadReview.current(); void renew()
    // The front page opens to begin with, and the top folders show what's in them.
    siteApi.files(space, folder).then(({ items }) => {
      if (!active) return
      files.current = items; setTree(items)
      setExpanded(new Set(items.filter(i => i.kind === 'folder' && !relative(folder, i).includes('/')).map(i => relative(folder, i))))
      if (items.some(i => i.kind === 'file' && relative(folder, i) === 'index.html')) actions.current.open('index.html')
    }).catch(e => { if (active) fail(e) })
    const timer = setInterval(renew, RENEW_MS)
    return () => { active = false; clearInterval(timer) }
  }, [space, folder])
  useLiveRefresh(groveUrl('/messages/events'), () => { void loadReview.current(); void loadTree().catch(() => {}) }, 30000, 'website')

  // One editor, showing whichever open file is chosen. Each file keeps its own state, with its undo history.
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: '' }) })
    editor.current = view
    return () => { view.destroy(); editor.current = null }
  }, [])
  async function stateFor(path: string, text: string) {
    const syntax = await language(path).catch(() => [])
    return EditorState.create({ doc: text, extensions: [
      keymap.of([{ key: 'Mod-s', run: () => { actions.current.save(); return true } }]), basicSetup, theme, syntaxHighlighting(colours), syntax,
      EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': `Code of ${path}` }),
      EditorView.updateListener.of(update => { if (update.docChanged) actions.current.changed(path) }),
    ] })
  }
  function show(path: string) {
    const view = editor.current, before = docs.current.get(shown.current)
    if (view && before?.state) before.state = view.state
    shown.current = path; setActive(path)
    const doc = docs.current.get(path)
    if (view && doc?.state) { view.setState(doc.state); view.focus() }
  }
  async function openFile(path: string, follow = false) {
    const known = docs.current.get(path)
    if (!known) {
      const item = files.current.find(i => i.kind === 'file' && rel(i) === path)
      if (!item) throw new Error(`${path} isn’t in this site any more.`)
      const doc: Open = { path, item, text: false, saved: '', version: item.version, state: null, drafted: false, stale: false }
      if (isText(item.name) && item.size <= TEXT_MAX) {
        const saved = await readText(space, item)
        const draft = item.draft ? await siteApi.draft(space, item.id).catch(() => null) : null
        Object.assign(doc, { text: true, saved, drafted: !!draft, version: draft?.version ?? item.version, stale: !!draft && draft.version !== item.version })
        doc.state = await stateFor(path, draft?.text ?? saved)
        if (docs.current.has(path)) return openFile(path, follow) // opened meanwhile
        mark(setDirty, path, doc.state.doc.toString() !== saved)
        mark(setStale, path, doc.stale)
      }
      docs.current.set(path, doc)
      setLoaded(map => new Map(map).set(path, { item: doc.item, text: doc.text }))
    }
    setTabs(list => list.includes(path) ? list : [...list, path])
    show(path)
    setPane('code')
    if (follow && /\.html?$/i.test(path)) frame.current?.show(pageAddress(path))
    return docs.current.get(path)!
  }
  const choose = (path: string, follow = true) => void openFile(path, follow).catch(fail)

  // Typing: a moment after it stops, the draft is kept and the preview catches up. Everything for one
  // file happens in turn, so a draft can't land after the save that ends it.
  function queue(path: string, work: () => Promise<void>) {
    const next = (chains.current.get(path) ?? Promise.resolve()).then(work)
    chains.current.set(path, next.catch(() => {}))
    return next
  }
  function refresh(path: string) { if (/\.css$/i.test(path)) frame.current?.restyle(); else frame.current?.reload() }
  async function keep(path: string) {
    const doc = docs.current.get(path)
    if (!doc?.state) return
    const text = textOf(path)
    try {
      if (text === doc.saved) {
        if (doc.drafted) await siteApi.dropDraft(space, doc.item.id)
        Object.assign(doc, { drafted: false, stale: false, version: doc.item.version }); mark(setDirty, path, false); mark(setStale, path, false)
      } else { await siteApi.keepDraft(space, doc.item.id, text, doc.version); doc.drafted = true }
      if (live.current) refresh(path)
    } catch (e) { fail(e) }
  }
  const changedNow = (path: string) => {
    mark(setDirty, path, true); setMessage('')
    clearTimeout(timers.current.get(path))
    timers.current.set(path, setTimeout(() => { timers.current.delete(path); void queue(path, () => keep(path)) }, KEEP_MS))
  }
  function save(path: string) {
    clearTimeout(timers.current.get(path)); timers.current.delete(path)
    return queue(path, async () => {
      const doc = docs.current.get(path)
      if (!doc?.state) return
      const text = textOf(path)
      if (text === doc.saved && !doc.drafted) { mark(setDirty, path, false); return }
      try {
        const result = await saveText(space, doc.item.id, text, doc.version)
        Object.assign(doc, { saved: text, version: result.version, drafted: false, stale: false, item: { ...doc.item, ...result, draft: null } })
        setLoaded(map => new Map(map).set(path, { item: doc.item, text: true }))
        files.current = files.current.map(i => i.id === result.id ? doc.item : i); setTree(files.current)
        mark(setStale, path, false)
        if (textOf(path) === text) mark(setDirty, path, false)
      } catch (e) {
        // Someone else saved since this draft began: say so, and offer both ways out.
        const latest = (await loadTree().catch(() => files.current)).find(i => i.id === doc.item.id)
        if (latest && latest.version !== doc.version) { doc.stale = true; mark(setStale, path, true) }
        throw e
      }
    })
  }
  const unsavedPaths = () => [...new Set([...dirty, ...(tree ?? []).filter(i => i.draft && !loaded.has(rel(i))).map(rel)])]
  async function saveAll() {
    const failed: string[] = []
    for (const path of [...dirty]) await save(path).catch(e => { failed.push(`${path}: ${(e as Error).message}`) })
    if (failed.length) throw new Error(failed.join(' '))
  }
  async function act(name: string, work: () => Promise<unknown>) {
    setBusy(name); setError('')
    try { await work() } catch (e) { fail(e) } finally { setBusy('') }
  }
  const saveShown = () => { const path = shown.current; if (path) void act('save', async () => { await save(path); flash(`Saved ${path}.`) }) }
  useEffect(() => { actions.current = { changed: changedNow, save: saveShown, open: path => void openFile(path).catch(fail) } })

  // A draft that began before someone else's save: use theirs, or save this one over it (theirs stays in its versions).
  async function takeSaved(path: string) {
    const doc = docs.current.get(path)
    if (!doc) return
    if (doc.drafted) await siteApi.dropDraft(space, doc.item.id)
    const item = (await loadTree()).find(i => i.id === doc.item.id) ?? doc.item
    const text = await readText(space, item)
    Object.assign(doc, { item, saved: text, version: item.version, drafted: false, stale: false, state: await stateFor(path, text) })
    if (shown.current === path) editor.current?.setState(doc.state!)
    setLoaded(map => new Map(map).set(path, { item, text: true }))
    mark(setDirty, path, false); mark(setStale, path, false); refresh(path)
  }
  async function keepMine(path: string) {
    const doc = docs.current.get(path)
    if (!doc) return
    const item = (await loadTree()).find(i => i.id === doc.item.id) ?? doc.item
    Object.assign(doc, { item, version: item.version, stale: false }); mark(setStale, path, false)
    await save(path)
  }

  // Nothing typed is lost if the page closes: it waits only for the moment it takes to keep it.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (timers.current.size) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  useEffect(() => { live.current = following }, [following])
  useEffect(() => {
    if (!picking) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPicking('') }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [picking])

  // Notes and the preview, back to the code.
  async function findInCode(page: string, quote: string, then?: (view: EditorView, found: ReturnType<typeof findQuote>, path: string) => void) {
    const path = pageFile(page, files.current.map(rel))
    if (!path) { setError(`There’s no page for ${page} in this site.`); return }
    await openFile(path)
    const view = editor.current
    if (!view) return
    const found = quote ? findQuote(view.state.doc.toString(), quote) : null
    if (found) view.dispatch({ selection: { anchor: found.from, head: found.to }, effects: EditorView.scrollIntoView(found.from, { y: 'center' }) })
    else if (quote) { view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: quote.split(/\s+/).slice(0, 4).join(' ') })) }); openSearchPanel(view) }
    view.focus()
    then?.(view, found, path)
  }
  const picked = (spot: Spot) => {
    if (picking === 'note') { setSpot(spot); setSide('notes') }
    else void findInCode(spot.page, spot.quote, (_view, found, path) => found ? flash(`Found in ${path}.`) : setError(`Those words aren’t in ${path} as they are on the page; search for part of them.`)).catch(fail)
    setPicking('')
  }
  const showNote = (note: SiteNote) => { setSelected(note.id); frame.current?.show(note.page, note.id); setPane(p => p === 'files' ? 'preview' : p) }
  const applyNote = (note: SiteNote) => void findInCode(note.page, note.quote, (view, found, path) => {
    if (!found) { setError(`“${note.quote.slice(0, 80)}” isn’t in ${path} as it is on the page. It may have changed already; search for part of it.`); return }
    if (found.count > 1) { flash(`These words are in ${path} ${found.count} times. The first is selected: change the one the note means.`); return }
    if (!found.plain) { flash(`These words are split up by tags in ${path}, so they’re selected for you to change by hand.`); return }
    const insert = asHtml(note.suggestion ?? '')
    view.dispatch({ changes: { from: found.from, to: found.to, insert }, selection: { anchor: found.from, head: found.from + insert.length }, scrollIntoView: true })
    flash(`The new wording is in ${path}. Check the preview, save, then mark note done.`)
  }).catch(fail)

  // Files: new ones, folders and uploads, wherever is chosen in the list.
  const folders = useMemo(() => ['', ...(tree ?? []).filter(i => i.kind === 'folder').map(i => relative(folder, i))], [tree, folder])
  const pages = useMemo(() => (review?.pages ?? []), [review])
  const inside = (sub: string) => sub ? `${folder}/${sub}` : folder
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget), name = String(data.get('name') ?? '').trim(), where = String(data.get('folder') ?? ''), from = String(data.get('from') ?? '')
    if (!name) return
    try {
      if (naming === 'folder') {
        await api(`/community/spaces/${space}/folders`, 'POST', { folder: inside(where), name })
        await loadTree(); setExpanded(set => new Set(set).add(where)); setPlace(where ? `${where}/${name}` : name); setNaming(null); return
      }
      const copy = from && files.current.find(i => i.kind === 'file' && rel(i) === from)
      const body = copy ? await readText(space, copy) : /\.html?$/i.test(name) ? blank(name) : ''
      await uploadFile(space, new File([body], name, { type: 'text/plain' }), { folder: inside(where) })
      await loadTree(); setNaming(null)
      await openFile(where ? `${where}/${name}` : name, true)
    } catch (e) { setNamingError((e as Error).message) }
  }
  const upload = (chosen: FileList) => { const list = Array.from(chosen); void act('upload', async () => {
    for (const file of list) {
      const earlier = files.current.find(i => i.kind === 'file' && i.folder === inside(place) && i.name === file.name)
      await uploadFile(space, file, { folder: inside(place), replaces: earlier?.id })
    }
    await loadTree(); flash(`Uploaded ${list.map(f => f.name).join(', ')}${place ? ` to ${place}` : ''}. A file with the same name gets a new version; the earlier ones stay in Files.`)
  }) }
  const publish = (first: boolean) => { setPublishing(false); void act('publish', async () => {
    if (first) await saveAll()
    const release = await api<Release>('/webmaster/publish', 'POST', { space_id: space, folder })
    flash(`Published. It’s live at ${address}.` + (release.hidden?.length ? ` The Grove keeps these addresses for itself, so they aren’t shown: ${release.hidden.join(', ')}.` : ''))
  }) }
  const close = (path: string) => {
    const at = tabs.indexOf(path), rest = tabs.filter(p => p !== path)
    setTabs(rest)
    if (shown.current === path) { const next = rest[Math.min(at, rest.length - 1)]; if (next) show(next); else { shown.current = ''; setActive('') } }
  }

  const unsaved = unsavedPaths(), doc = active ? loaded.get(active) : undefined
  const children = useMemo(() => {
    const map = new Map<string, SiteFile[]>()
    for (const item of tree ?? []) { const path = relative(folder, item), parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; map.set(parent, [...(map.get(parent) ?? []), item]) }
    return map
  }, [tree, folder])
  const branch = (at: string, depth: number): React.ReactNode => <ul className="site-tree" role={depth ? 'group' : undefined}>{(children.get(at) ?? []).map(item => {
    const path = rel(item)
    if (item.kind === 'folder') {
      const open = expanded.has(path)
      return <li key={item.id}><button className={'tree-item' + (place === path ? ' chosen' : '')} style={{ paddingLeft: 8 + depth * 14 }} aria-expanded={open}
        onClick={() => { setPlace(path); setExpanded(set => { const next = new Set(set); if (open) next.delete(path); else next.add(path); return next }) }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={15} /> {item.name}</button>
        {open && branch(path, depth + 1)}</li>
    }
    const Icon = isImage(item.name) ? ImageIcon : isText(item.name) ? FileText : FileIcon
    const changes = loaded.has(path) ? dirty.has(path) : !!item.draft
    return <li key={item.id}><button className={'tree-item' + (active === path ? ' active' : '')} style={{ paddingLeft: 22 + depth * 14 }} aria-current={active === path ? 'true' : undefined}
      onClick={() => { setPlace(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''); choose(path) }}>
      <Icon size={15} /> <span className="tree-name">{item.name}</span>{changes && <span className="unsaved-dot" title="Unsaved changes" aria-label="unsaved changes" />}</button></li>
  })}</ul>
  const openNotes = review?.notes.filter(n => n.status === 'open').length ?? 0
  return <div className={`site-studio show-${pane}`} onKeyDown={e => { if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveShown() } }}>
    <header className="studio-bar">
      <button className="text-button back" onClick={onBack}><ArrowLeft size={15} /> Webmaster tools</button>
      <div className="studio-title"><strong>{review?.name ?? folder.replace(/^Website\//, '')}</strong>
        <small className="muted-text" role="status">{unsaved.length ? `${unsaved.length} ${unsaved.length === 1 ? 'file has' : 'files have'} changes not saved yet. They’re kept as you type.` : 'Everything is saved.'}</small></div>
      <div className="action-row">
        <button className="secondary" disabled={!!busy || !dirty.has(active)} onClick={saveShown}><Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button className="secondary" disabled={!!busy || !dirty.size} onClick={() => void act('save', async () => { await saveAll(); flash('Everything is saved.') })}>Save all</button>
        <button className="secondary" onClick={onReview}><Eye size={15} /> Preview & notes</button>
        <button className="primary" disabled={!!busy} onClick={() => setPublishing(true)}><Rocket size={15} /> {busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
      </div>
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <nav className="studio-panes" aria-label="Show">
      {(['files', 'code', 'preview'] as const).map(p => <button key={p} className={pane === p ? 'primary' : 'secondary'} aria-pressed={pane === p} onClick={() => setPane(p)}>{p === 'files' ? 'Files & notes' : p === 'code' ? 'Code' : 'Preview'}</button>)}
    </nav>
    <div className="studio-grid">
      <aside className="studio-side">
        <div className="side-tabs" role="tablist">
          <button role="tab" aria-selected={side === 'files'} className={side === 'files' ? 'primary' : 'secondary'} onClick={() => setSide('files')}><Folder size={14} /> Files</button>
          <button role="tab" aria-selected={side === 'notes'} className={side === 'notes' ? 'primary' : 'secondary'} onClick={() => setSide('notes')}><MessageSquare size={14} /> Notes{openNotes ? ` (${openNotes})` : ''}</button>
        </div>
        {side === 'files' ? <>
          <div className="tree-actions">
            <button className="icon-button" title="New file" aria-label="New file" onClick={() => { setNamingError(''); setNaming('file') }}><FilePlus size={16} /></button>
            <button className="icon-button" title="New folder" aria-label="New folder" onClick={() => { setNamingError(''); setNaming('folder') }}><FolderPlus size={16} /></button>
            <button className="icon-button" title="Upload pictures or files" aria-label="Upload" disabled={busy === 'upload'} onClick={() => picker.current?.click()}><Upload size={16} /></button>
            <small className="muted-text">{place ? `In ${place}` : 'At the top'}</small>
          </div>
          <input ref={picker} type="file" multiple hidden aria-label="Choose files to upload" onChange={e => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
          <button className={'tree-item' + (place === '' ? ' chosen' : '')} onClick={() => setPlace('')}><Folder size={15} /> {review?.name ?? 'Site'}</button>
          {tree ? branch('', 0) : <p className="muted-text">Loading…</p>}
          <p className="muted-text tree-help">Rename, move or delete files in <button className="text-button" onClick={onFiles}>Files</button>, where earlier versions and the trash are.</p>
        </> : review && <NotesPanel notes={review.notes} user={user} here={here} selected={selected} onShow={showNote} onChanged={() => void loadReview.current()}
          onApply={applyNote} onCode={note => void findInCode(note.page, note.quote).catch(fail)}>
          <button className="secondary" onClick={() => { setSpot(null); setPicking('note'); setPane('preview') }}><MessageSquarePlus size={15} /> Add a note</button>
          {spot && <NoteComposer key={spot.page + spot.selector + spot.x} spot={spot} device={device} target={target} onCancel={() => setSpot(null)}
            onSaved={note => { setSpot(null); setSelected(note.id); void loadReview.current() }} />}
        </NotesPanel>}
      </aside>
      <section className="studio-code" aria-label="Code">
        <div className="code-tabs" role="tablist">{tabs.map(path => <span key={path} className={'code-tab' + (path === active ? ' active' : '')}>
          <button role="tab" aria-selected={path === active} title={path} onClick={() => show(path)}>{path.split('/').pop()}{dirty.has(path) && <span className="unsaved-dot" aria-label="unsaved changes" />}</button>
          <button className="icon-button" aria-label={`Close ${path}`} title={dirty.has(path) ? 'Close. Your changes stay as a draft.' : 'Close'} onClick={() => close(path)}><X size={13} /></button>
        </span>)}</div>
        {active && stale.has(active) && <div className="notice stale" role="alert">Someone saved a newer version of {active} after your changes began.
          <span className="action-row"><button className="secondary" onClick={() => void act('stale', () => takeSaved(active))}>Use the saved version</button>
            <button className="secondary" onClick={() => void act('stale', () => keepMine(active))}>Save mine over it</button></span>
          <small>Either way, every version stays in Files.</small></div>}
        <div className="code-host" ref={host} hidden={!doc?.text} />
        {doc && !doc.text && <div className="studio-media">
          {isImage(doc.item.name) ? <img src={contentUrl(space, doc.item.id, '?inline=1')} alt={doc.item.name} /> : <p>{doc.item.size > TEXT_MAX ? 'This file is too large to edit here.' : 'This kind of file can’t be edited as text.'}</p>}
          <p>Use it in your pages as <code>/{active}</code> <button className="icon-button" aria-label="Copy its address" title="Copy" onClick={() => void navigator.clipboard?.writeText('/' + active).then(() => flash('Copied.'))}><Copy size={14} /></button></p>
          <p className="muted-text">Changed {stamp(doc.item.updated)}{doc.item.updated_by ? ` by ${doc.item.updated_by}` : ''} · version {doc.item.version}</p>
          <a className="secondary button-link" href={contentUrl(space, doc.item.id)} download onClick={saveLink(doc.item.name, fail)}><Download size={15} /> Download</a>
        </div>}
        {!active && <p className="muted-text code-empty">Choose a file to change it. Pages, styles and scripts open here; what you type shows in the preview as you go.</p>}
      </section>
      <section className="studio-preview" aria-label="Preview">
        <PreviewBar pages={pages} here={here} device={device} onDevice={setDevice} onPage={a => frame.current?.show(a)}>
          <button className={picking === 'code' ? 'primary' : 'icon-button'} aria-pressed={picking === 'code'} title="Click something in the preview to find it in the code" aria-label="Find in code"
            onClick={() => setPicking(p => p === 'code' ? '' : 'code')}><Crosshair size={16} /></button>
          <button className="icon-button" title="Reload the preview" aria-label="Reload the preview" onClick={() => frame.current?.reload()}><RefreshCw size={16} /></button>
          {url && <a className="icon-button" href={grove.url + url.replace(/\/$/, '') + here} target="_blank" rel="noopener noreferrer" onClick={openOutside} title="Open in a new tab" aria-label="Open in a new tab"><ExternalLink size={16} /></a>}
        </PreviewBar>
        <div className="preview-options">
          <label className="check"><input type="checkbox" checked={following} onChange={e => setFollowing(e.target.checked)} /> Update as I type</label>
          <button className="text-button" onClick={() => { const path = pageFile(here, files.current.map(rel)); if (path) choose(path, false) }}>Edit this page</button>
        </div>
        {picking && <p className="pick-hint" role="status">{picking === 'code' ? 'Click something in the preview to find it in the code.' : 'Click the part of the page your note is about.'} <button className="text-button" onClick={() => setPicking('')}>Cancel</button></p>}
        {url ? <PreviewFrame ref={frame} url={url} device={device} title="Preview, with your unsaved changes" picking={!!picking}
          pins={review ? pinsFor(review.notes, here, selected) : []} onPage={setHere} onPicked={picked} onPickEnd={() => setPicking('')}
          onPin={id => { setSelected(id); setSide('notes') }} /> : <p className="preview-stage">Opening the preview…</p>}
      </section>
    </div>
    {naming && <Modal title={naming === 'file' ? 'New file' : 'New folder'} onClose={() => setNaming(null)}>
      <form onSubmit={create}>
        <label>Name<input name="name" required maxLength={200} autoFocus placeholder={naming === 'file' ? 'about.html' : 'images'} /></label>
        <label>In<select name="folder" defaultValue={folders.includes(place) ? place : ''}>{folders.map(f => <option key={f} value={f}>{f || 'The top of the site'}</option>)}</select></label>
        {naming === 'file' && <label>Start from<select name="from" defaultValue=""><option value="">A blank page</option>{pages.map(p => <option key={p} value={p}>A copy of {p}</option>)}</select></label>}
        {naming === 'file' && <p className="muted-text">A page’s name ends in .html: about.html is at {address}/about. Styles end in .css, scripts in .js.</p>}
        {namingError && <p className="error" role="alert">{namingError}</p>}
        <div className="action-row"><button className="primary">{naming === 'file' ? 'Make file' : 'Make folder'}</button><button type="button" className="secondary" onClick={() => setNaming(null)}>Cancel</button></div>
      </form>
    </Modal>}
    {publishing && <Modal title={`Publish ${review?.name ?? 'this site'}?`} onClose={() => setPublishing(false)}>
      {unsaved.length ? <>
        <p>{unsaved.length === 1 ? `${unsaved[0]} has changes` : `${unsaved.length} files have changes`} that aren’t saved yet. Publishing puts the saved files at {address}.</p>
        <div className="action-row"><button className="primary" disabled={unsaved.length !== dirty.size} onClick={() => publish(true)}><Rocket size={15} /> Save all and publish</button>
          <button className="secondary" onClick={() => publish(false)}>Publish what’s saved</button><button className="secondary" onClick={() => setPublishing(false)}>Cancel</button></div>
        {unsaved.length !== dirty.size && <p className="muted-text">Some of those drafts aren’t open. Open them to save them, or publish what’s saved.</p>}
      </> : <>
        <p>Visitors to {address} see it straight away. Earlier versions can be put back from Webmaster tools.</p>
        <div className="action-row"><button className="primary" onClick={() => publish(false)}><Rocket size={15} /> Publish</button><button className="secondary" onClick={() => setPublishing(false)}>Cancel</button></div>
      </>}
    </Modal>}
  </div>
}

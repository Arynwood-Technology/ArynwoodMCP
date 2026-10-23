import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Download, File as FileIcon, FileText, Folder, FolderPlus, Image as ImageIcon, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react'
import { api, stamp, type Space, type User } from '../lib/community'
import { openOutside, saveLink } from '../lib/grove'
import { bytes, contentUrl, freeName, inWebsite, isImage, isText, joined, readText, uploadFile, zipUrl, type FileItem, type Listing, type Version } from '../lib/files'
import { useSpaceRefresh } from '../lib/live'
import { readCSV } from '../lib/spreadsheet'
import { Modal } from './Workspace'
import './files.css'
// The table editor and New spreadsheet / New document are held back until documents and spreadsheets
// have proper editors; CSV and Markdown files still open in the text editor.
const DOCUMENT_TOOLS = false
const SpreadsheetEditor = lazy(() => import('../components/SpreadsheetEditor').then(module => ({ default: module.SpreadsheetEditor })))
const CodeEditor = lazy(() => import('../components/CodeEditor').then(module => ({ default: module.CodeEditor })))

interface Sending { key: string; name: string; size: number; sent: number; error?: string }
type Naming = { kind: 'folder' | 'spreadsheet' | 'document' } | { kind: 'rename'; item: FileItem }

/** A space's shared files: folders, uploads that survive a dropped connection, versions and a trash. */
export function FileBank({ space, user, startFolder = '' }: { space: Space; user: User; startFolder?: string }) {
  const root = `/community/spaces/${space.id}`
  const [folder, setFolder] = useState(startFolder), [trash, setTrash] = useState(false)
  // Kept with the view it was loaded for, so a page never shows one folder's items under another's buttons.
  const view = trash ? '\u0000trash' : folder
  const [loaded, setLoaded] = useState<{ view: string; data: Listing } | null>(null)
  const listing = loaded?.view === view ? loaded.data : null
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [sending, setSending] = useState<Sending[]>([])
  const [naming, setNaming] = useState<Naming | null>(null), [namingError, setNamingError] = useState('')
  const [open, setOpen] = useState<FileItem | null>(null), [binning, setBinning] = useState<FileItem | null>(null)
  const [clashes, setClashes] = useState<File[]>([]), [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null), load = useRef(async () => {})
  // A space's Website folder holds the Grove's website: only its owners and webmasters change it.
  const owner = space.role === 'owner', locked = (path: string) => !user.webmaster && inWebsite(path)
  const mine = (item: FileItem) => inWebsite(joined(item.folder, item.name)) ? !!user.webmaster : owner || item.author_id === user.id
  const flash = (text: string) => { setMessage(text); setError('') }
  const fail = (e: unknown) => { setError((e as Error).message); setMessage('') }

  useEffect(() => {
    let active = true
    load.current = async () => {
      try { const data = await api<Listing>(`${root}/files?` + new URLSearchParams(trash ? { trash: '1' } : { folder })); if (active) { setLoaded({ view, data }); setError('') } }
      catch (e) { if (active) setError((e as Error).message) }
    }
    void load.current()
    return () => { active = false }
  }, [root, folder, trash, view])
  useSpaceRefresh(space.id, () => void load.current(), 30000)

  async function send(file: File, options: { name?: string; replaces?: string } = {}) {
    const key = `${file.name}:${Math.random()}`
    setSending(list => [...list, { key, name: options.name ?? file.name, size: file.size, sent: 0 }])
    try {
      await uploadFile(space.id, file, { folder, ...options, onProgress: sent => setSending(list => list.map(s => s.key === key ? { ...s, sent } : s)) })
      setSending(list => list.filter(s => s.key !== key))
      void load.current()
    } catch (e) { setSending(list => list.map(s => s.key === key ? { ...s, error: (e as Error).message } : s)) }
  }
  function choose(chosen: FileList | File[]) {
    const files = Array.from(chosen), names = new Set(listing?.items.map(i => i.name))
    files.filter(f => !names.has(f.name)).forEach(f => void send(f))
    setClashes(files.filter(f => names.has(f.name)))
  }
  const clash = clashes[0], existing = clash && listing?.items.find(i => i.name === clash.name)
  function settle(choice: 'version' | 'both' | 'skip') {
    if (choice === 'version' && existing) void send(clash, { replaces: existing.id })
    if (choice === 'both') void send(clash, { name: freeName(clash.name, new Set(listing?.items.map(i => i.name))) })
    setClashes(rest => rest.slice(1))
  }
  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!naming || !value) return
    try {
      if (naming.kind === 'folder') await api(`${root}/folders`, 'POST', { folder, name: value })
      else if (naming.kind === 'spreadsheet' || naming.kind === 'document') {
        const extension = naming.kind === 'spreadsheet' ? '.csv' : '.md'
        const name = value.toLowerCase().endsWith(extension) ? value : value + extension
        const data = naming.kind === 'spreadsheet' ? 'Column 1,Column 2\r\n,\r\n' : '# ' + value.replace(/\.md$/i, '') + '\n\n'
        const saved = await uploadFile(space.id, new File([data], name, { type: 'text/plain' }), { folder })
        setOpen(saved)
      }
      else if (naming.kind === 'rename') await api(`${root}/files/${naming.item.id}`, 'PUT', { folder: naming.item.folder, name: value })
      setNaming(null); void load.current()
    } catch (e) { setNamingError((e as Error).message) }
  }
  async function act(request: Promise<unknown>, done: string) {
    try { await request; flash(done); void load.current() } catch (e) { fail(e) }
  }

  const crumbs = folder ? folder.split('/') : []
  const items = listing?.items ?? []
  const used = listing ? Math.min(100, listing.used / listing.limit * 100) : 0
  return <div className={'workspace file-bank' + (dragging ? ' dropping' : '')}
    onDragOver={e => { if (!trash && !locked(folder) && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
    onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
    onDrop={e => { e.preventDefault(); setDragging(false); if (!trash && !locked(folder)) choose(e.dataTransfer.files) }}>
    <div className="page-heading"><div><span className="eyebrow">{space.name}</span><h1>{trash ? 'Trash' : 'Files'}</h1>
      <p>{trash ? 'Deleted things wait here for 30 days, then go for good.' : 'Documents, artwork and anything else this space keeps together.'}</p></div>
      <div className="action-row">{trash ? <button className="secondary" onClick={() => setTrash(false)}><ArrowLeft size={15} /> Back to files</button> : <>
        {!locked(folder) && <><button className="primary" onClick={() => picker.current?.click()}><Upload size={15} /> Upload</button>
        <button className="secondary" onClick={() => { setNamingError(''); setNaming({ kind: 'folder' }) }}><FolderPlus size={15} /> New folder</button></>}
        {DOCUMENT_TOOLS && <><button className="secondary" onClick={() => { setNamingError(''); setNaming({ kind: 'spreadsheet' }) }}>New spreadsheet</button>
        <button className="secondary" onClick={() => { setNamingError(''); setNaming({ kind: 'document' }) }}>New document</button></>}
        <button className="secondary" onClick={() => setTrash(true)}><Trash2 size={15} /> Trash</button></>}</div></div>
    <input ref={picker} type="file" multiple hidden aria-label="Choose files to upload" onChange={e => { if (e.target.files) choose(e.target.files); e.target.value = '' }} />
    {error && <p className="error" role="alert">{error}{folder && <button className="text-button" onClick={() => setFolder('')}>Back to all files</button>}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {!trash && locked(folder) && <p className="notice">These are the Grove’s website files. Only its owners and webmasters change them; anyone can preview the site from <strong>Website</strong> in the menu.</p>}
    {listing && <div className="usage"><span>{bytes(listing.used)} of {bytes(listing.limit)} used</span><span className="usage-bar" aria-hidden="true"><span style={{ width: `${used}%` }} /></span></div>}
    {!trash && <nav className="crumbs" aria-label="Folders">
      <button className="text-button" onClick={() => setFolder('')} aria-current={folder ? undefined : 'page'}>Files</button>
      {crumbs.map((part, i) => <span key={i}><ChevronRight size={14} aria-hidden="true" /><button className="text-button" aria-current={i === crumbs.length - 1 ? 'page' : undefined} onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}>{part}</button></span>)}
    </nav>}
    {sending.length > 0 && <ul className="upload-list" aria-label="Uploads">{sending.map(s => <li key={s.key}>
      <span className="name">{s.name}</span>
      {s.error ? <><span className="danger">{s.error}</span><button className="text-button" onClick={() => setSending(list => list.filter(x => x.key !== s.key))}>Dismiss</button></>
        : <><progress max={s.size || 1} value={s.sent} aria-label={`Uploading ${s.name}`} /><small>{bytes(s.sent)} of {bytes(s.size)}</small></>}
    </li>)}</ul>}
    <ul className="file-list">{items.map(item => <li key={item.id}>
      <span className="file-icon" aria-hidden="true">{item.kind === 'folder' ? <Folder size={20} /> : isImage(item.name) ? <ImageIcon size={20} /> : isText(item.name) ? <FileText size={20} /> : <FileIcon size={20} />}</span>
      <span className="who">{trash ? <strong>{item.name}</strong> : <button className="file-name" onClick={() => item.kind === 'folder' ? setFolder(joined(item.folder, item.name)) : setOpen(item)}>{item.name}</button>}
        <small>{item.kind === 'file' ? `${bytes(item.size)} · ` : ''}{trash ? `${item.folder ? `from ${item.folder} · ` : ''}deleted ${stamp(item.deleted ?? item.updated)}` : `${item.updated_by || item.author} · ${stamp(item.updated)}`}{item.version > 1 ? ` · version ${item.version}` : ''}</small></span>
      <span className="file-actions">{trash ? <>
        {mine(item) && <button className="secondary" onClick={() => void act(api(`${root}/files/${item.id}/restore`, 'POST'), `${item.name} is back.`)}><RotateCcw size={14} /> Restore</button>}
        {owner && !locked(joined(item.folder, item.name)) && <button className="text-button danger" onClick={() => void act(api(`${root}/trash/${item.id}`, 'DELETE'), `${item.name} is gone for good.`)}>Delete forever</button>}
      </> : <>
        {item.kind === 'file' ? <a className="icon-button" href={contentUrl(space.id, item.id)} download onClick={saveLink(item.name, fail)} aria-label={`Download ${item.name}`} title="Download"><Download size={16} /></a>
          : <a className="icon-button" href={zipUrl(space.id, item.id)} download onClick={saveLink(`${item.name}.zip`, fail)} aria-label={`Download ${item.name} as a .zip`} title="Download as a .zip"><Download size={16} /></a>}
        {mine(item) && <button className="icon-button" aria-label={`Rename ${item.name}`} title="Rename" onClick={() => { setNamingError(''); setNaming({ kind: 'rename', item }) }}><Pencil size={16} /></button>}
        {mine(item) && <button className="icon-button" aria-label={`Delete ${item.name}`} title="Move to the trash" onClick={() => setBinning(item)}><Trash2 size={16} /></button>}
      </>}</span>
    </li>)}</ul>
    {listing && !items.length && <p className="muted-text empty-files">{trash ? 'The trash is empty.' : 'Nothing here yet. Upload files, or drop them on this page.'}</p>}
    {naming && <Modal title={naming.kind === 'rename' ? `Rename ${naming.item.name}` : `New ${naming.kind}`} onClose={() => setNaming(null)}>
      <form onSubmit={saveName}>
        <label>Name<input name="name" required maxLength={200} autoFocus defaultValue={naming.kind === 'rename' ? naming.item.name : ''} /></label>
        {namingError && <p className="error" role="alert">{namingError}</p>}
        <div className="action-row"><button className="primary">{naming.kind === 'rename' ? 'Rename' : naming.kind === 'folder' ? 'Make folder' : `Create ${naming.kind}`}</button><button type="button" className="secondary" onClick={() => setNaming(null)}>Cancel</button></div>
      </form>
    </Modal>}
    {binning && <Modal title={`Delete ${binning.name}?`} onClose={() => setBinning(null)}>
      <p>{binning.kind === 'folder' ? 'It goes to the trash with everything in it.' : 'It goes to the trash.'} Anyone who added it, or a space owner, can bring it back within 30 days.</p>
      <div className="action-row"><button className="danger-button" onClick={() => { const item = binning; setBinning(null); void act(api(`${root}/files/${item.id}`, 'DELETE'), `${item.name} is in the trash.`) }}>Move to the trash</button><button className="secondary" onClick={() => setBinning(null)}>Cancel</button></div>
    </Modal>}
    {clash && <Modal title={`${clash.name} is already here`} onClose={() => settle('skip')}>
      <p>{existing?.kind === 'file' ? 'Upload it as a new version? The earlier versions are kept.' : 'A folder already has this name.'}</p>
      <div className="action-row">{existing?.kind === 'file' && <button className="primary" onClick={() => settle('version')}>New version</button>}
        <button className="secondary" onClick={() => settle('both')}>Keep both</button><button className="secondary" onClick={() => settle('skip')}>Skip</button></div>
    </Modal>}
    {open && <FilePreview space={space} item={open} locked={locked(open.folder)} onClose={() => setOpen(null)} onNewVersion={file => { const item = open; setOpen(null); void send(file, { replaces: item.id }) }} />}
  </div>
}

function FilePreview({ space, item, locked, onClose, onNewVersion }: { space: Space; item: FileItem; locked: boolean; onClose: () => void; onNewVersion: (file: File) => void }) {
  const [current, setCurrent] = useState(item), [editing, setEditing] = useState(false), [sheet, setSheet] = useState(false)
  const [text, setText] = useState<string | null>(null), [versions, setVersions] = useState<Version[]>([]), [raw, setRaw] = useState(false)
  // A CSV or TSV reads as a table; one the reader can't make sense of shows as text.
  const table = useMemo(() => {
    if (text === null || !/\.(csv|tsv)$/i.test(item.name)) return null
    try { return readCSV(text, /\.tsv$/i.test(item.name) ? '\t' : ',') } catch { return null }
  }, [text, item.name])
  useEffect(() => {
    let active = true
    api<Version[]>(`/community/spaces/${space.id}/files/${item.id}/versions`).then(v => { if (active) setVersions(v) }).catch(() => {})
    if (isText(item.name) && item.size <= 2 * 1024 * 1024) readText(space.id, { id: item.id, version: item.version }).then(t => { if (active) setText(t) }).catch(() => {})
    return () => { active = false }
  }, [space.id, item.id, item.name, item.size, item.version])
  if (sheet && text !== null) return <Suspense fallback={<Modal title={item.name} onClose={() => setSheet(false)}><p>Opening spreadsheet…</p></Modal>}><SpreadsheetEditor spaceId={space.id} item={current} text={text} onClose={() => setSheet(false)} onSaved={(saved, contents) => { setCurrent(saved); setText(contents); void api<Version[]>(`/community/spaces/${space.id}/files/${item.id}/versions`).then(setVersions).catch(() => {}) }}/></Suspense>
  if (editing && text !== null) return <Suspense fallback={<Modal title={item.name} onClose={() => setEditing(false)}><p>Opening editor…</p></Modal>}><CodeEditor spaceId={space.id} item={current} text={text} onClose={() => setEditing(false)} onSaved={(saved, contents) => {
    setCurrent(saved); setText(contents)
    void api<Version[]>(`/community/spaces/${space.id}/files/${item.id}/versions`).then(setVersions).catch(() => {})
  }}/></Suspense>
  return <Modal title={item.name} onClose={onClose}>
    {isImage(item.name) && <img className="file-preview" src={contentUrl(space.id, item.id, '?inline=1')} alt={item.name} />}
    {table && !raw ? <Table rows={table} /> : text !== null && <pre className="file-text">{text}</pre>}
    {table && <button className="text-button" onClick={() => setRaw(r => !r)}>{raw ? 'Show as a table' : 'Show as text'}</button>}
    {/\.pdf$/i.test(item.name) && <p><a href={contentUrl(space.id, item.id, '?inline=1')} target="_blank" rel="noopener noreferrer" onClick={openOutside}>Open the PDF in a new tab</a></p>}
    <p className="muted-text">{bytes(current.size)} · added by {item.author || 'someone who has left'} · {stamp(item.created)}</p>
    <div className="action-row">
      {DOCUMENT_TOOLS && /\.csv$/i.test(current.name) && text !== null && <button className="primary" onClick={() => setSheet(true)}>Open spreadsheet</button>}
      {!locked && isText(current.name) && current.size <= 2 * 1024 * 1024 && text !== null && <button className="primary" onClick={() => setEditing(true)}>Edit</button>}
      <a className="primary button-link" href={contentUrl(space.id, item.id)} download onClick={saveLink(current.name)}><Download size={15} /> Download</a>
      {!locked && <label className="secondary button-link"><Upload size={15} /> Upload a new version<input type="file" hidden onChange={e => { const file = e.target.files?.[0]; if (file) onNewVersion(file) }} /></label>}
    </div>
    {versions.length > 1 && <section className="versions"><h3>Versions</h3><ul>{versions.map(v => <li key={v.version}>
      <span>Version {v.version} · {bytes(v.size)} · {v.author || 'someone who has left'} · {stamp(v.created)}</span>
      <a href={contentUrl(space.id, item.id, `?version=${v.version}`)} download onClick={saveLink(current.name)}>Download</a></li>)}</ul></section>}
  </Modal>
}

const TABLE_ROWS = 500
const NUMBER = /^[-+]?[$€£]?\s?\d[\d,]*(\.\d+)?%?$/
/** A CSV's rows under its first row's headings. Columns of numbers line up on the right. */
function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows, shown = body.slice(0, TABLE_ROWS)
  const numeric = head.map((_, c) => body.some(r => r[c].trim()) && body.every(r => !r[c].trim() || NUMBER.test(r[c].trim())))
  return <>
    <div className="csv-table" tabIndex={0} role="region" aria-label="Table"><table>
      <thead><tr>{head.map((name, c) => <th key={c} scope="col" className={numeric[c] ? 'number' : undefined}>{name}</th>)}</tr></thead>
      <tbody>{shown.map((row, r) => <tr key={r}>{row.map((value, c) => <td key={c} className={numeric[c] ? 'number' : undefined}>{value}</td>)}</tr>)}</tbody>
    </table></div>
    <p className="muted-text">{body.length} {body.length === 1 ? 'row' : 'rows'}, {head.length} {head.length === 1 ? 'column' : 'columns'}{body.length > TABLE_ROWS ? `. Showing the first ${TABLE_ROWS}; download it to see them all.` : ''}</p>
  </>
}

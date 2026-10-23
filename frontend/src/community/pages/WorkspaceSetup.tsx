import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Space } from '../lib/community'

interface Kit { kit: string; name: string; description: string; root: string; lists: number; items: number; notes: number; tasks: number; folders: number; files: number; spreadsheets: number; events: number; departments: string[]; trackers: string[] }
interface Installed { kit: string; client: string; opening_date: string; created: string }
export function WorkspaceSetup({ space }: { space: Space }) {
  const [kits, setKits] = useState<Kit[]>([]), [installed, setInstalled] = useState<Installed[]>([])
  const [kit, setKit] = useState('film-festival'), [client, setClient] = useState(space.name), [opening, setOpening] = useState('')
  const [preview, setPreview] = useState<Kit | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
  const [error, setError] = useState(''), [done, setDone] = useState<Kit | null>(null)
  const root = `/community/spaces/${space.id}/workspace-setup`
  useEffect(() => { let active = true; api<{ kits: Kit[]; installed: Installed[] }>(root).then(data => { if (active) { setKits(data.kits); setInstalled(data.installed); setReady(true) } }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [root])
  const selected = kits.find(k => k.kit === kit), existing = installed.find(k => k.kit === kit)
  function change() { setPreview(null); setDone(null); setError('') }
  async function submit(apply: boolean) {
    setBusy(true); setError('')
    try {
      const result = await api<Kit>(root + (apply ? '' : '/preview'), 'POST', { kit, client, opening_date: kit === 'film-festival' && opening ? opening : null })
      if (apply) { setDone(result); setPreview(null); setInstalled(rows => [...rows, { kit, client, opening_date: opening, created: new Date().toISOString() }]) }
      else setPreview(result)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="workspace">
    <div className="page-heading"><div><span className="eyebrow">{space.name}</span><h1>Workspace setup</h1><p>Stage a working set of checklists, documents, asset folders and trackers for your team.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {done && <section className="panel" role="status"><h2>{client} is staged</h2><p>{done.lists} lists, {done.items} checklist items, {done.notes} notes, {done.tasks} tasks, {done.files} files and {done.folders} folders are ready.{done.events ? ` ${done.events} proposed calendar events need your approval.` : ' Calendar dates remain unset.'}</p><div className="action-row"><Link className="primary" to="/community/lists">Open lists</Link><Link className="secondary" to={'/community/files?folder='+encodeURIComponent(done.root)}>Open documents & trackers</Link><Link className="secondary" to="/community/calendar">Open calendar</Link><Link className="secondary" to="/community/household">Assign setup tasks</Link></div></section>}
    {!ready && !error && <p>Loading workspace kits…</p>}
    {ready && <form className="panel" onSubmit={e => { e.preventDefault(); void submit(false) }}>
      <label>Workspace kit<select value={kit} disabled={busy} onChange={e => { setKit(e.target.value); change() }}>{kits.map(k => <option key={k.kit} value={k.kit}>{k.name}</option>)}</select></label>
      <p>{selected?.description}</p>
      <label>Client or project name<input value={client} onChange={e => { setClient(e.target.value); change() }} required maxLength={80} disabled={busy}/></label>
      {kit === 'film-festival' && <><label>Opening date (optional)<input type="date" value={opening} disabled={busy} onChange={e => { setOpening(e.target.value); change() }}/></label><p className="muted-text">Leave blank until confirmed. A date adds proposed milestones at 9 AM, including a three-day festival outline. Confirm times, timezone, closing date and venues in Calendar before using them.</p></>}
      <p>New content is shared with the members of <strong>{space.name}</strong>. Choose a separate restricted space for confidential finance, contracts or jury records. Folder names do not limit access.</p>
      {existing ? <p className="notice">This kit was staged for {existing.client} on {new Date(existing.created).toLocaleDateString()}. Keep working with those records, or create a new space for another edition.</p> : <button className="primary" disabled={busy || !client.trim()}>{busy ? 'Preparing…' : 'Preview setup'}</button>}
    </form>}
    {(preview || selected) && <section className="panel" style={{ marginTop: 20 }}><h2>{preview ? 'Ready to stage' : 'Included in this kit'}</h2><p>{(preview ?? selected)!.lists} department lists · {(preview ?? selected)!.items} checklist items · {(preview ?? selected)!.notes} operating notes · {(preview ?? selected)!.spreadsheets} CSV trackers</p>
      <div className="card-grid"><div><h3>Department checklists</h3><ul>{(preview ?? selected)!.departments.map(name => <li key={name}>{name}</li>)}</ul></div><div><h3>Documents & trackers</h3><ul>{(preview ?? selected)!.trackers.map(path => <li key={path}>{path.split('/').slice(1).join('/')}</li>)}</ul></div></div>
      {preview && <><p>{preview.events ? `${preview.events} proposed events will be added for review.` : 'No calendar events will be added until dates are confirmed.'} Budget amounts, film records and contacts start blank. Checklists name suggested roles; the producer assigns the people.</p><button type="button" className="primary" disabled={busy || !!existing} onClick={() => void submit(true)}>{busy ? 'Staging…' : `Stage ${client.trim()} workspace`}</button></>}
    </section>}
  </div>
}

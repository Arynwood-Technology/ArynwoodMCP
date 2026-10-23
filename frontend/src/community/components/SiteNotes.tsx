import { useEffect, useRef, useState } from 'react'
import { Check, Code, LocateFixed, Monitor, RotateCcw, Smartphone, Sparkles, Tablet, Trash2 } from 'lucide-react'
import { stamp, type User } from '../lib/community'
import { pageAddress, samePage, siteApi, type Device, type SiteNote, type Spot } from '../lib/site'

const DEVICE_NAMES: Record<Device, string> = { computer: 'Computer', tablet: 'Tablet', phone: 'Phone' }
const ICONS = { computer: Monitor, tablet: Tablet, phone: Smartphone }
const short = (text: string, max = 140) => text.length > max ? text.slice(0, max - 1) + '…' : text
const picture = (selector: string) => /(^|> )img:/.test(selector.split(' > ').pop() ?? '')

/** Which page of a site to show, and at what size. */
export function PreviewBar({ pages, here, device, onPage, onDevice, children }: {
  pages: string[]; here: string; device: Device; onPage: (address: string) => void; onDevice: (device: Device) => void; children?: React.ReactNode
}) {
  const current = pages.find(p => samePage(pageAddress(p), here))
  return <div className="preview-bar">
    <label className="page-choice">Page
      <select value={current ? pageAddress(current) : ''} onChange={e => onPage(e.target.value)}>
        {!current && <option value="">{here}</option>}
        {pages.map(p => <option key={p} value={pageAddress(p)}>{p === 'index.html' ? 'Home' : pageAddress(p)}</option>)}
      </select>
    </label>
    <div className="device-choice" role="group" aria-label="Show it on">
      {(Object.keys(DEVICE_NAMES) as Device[]).map(d => { const Icon = ICONS[d]; return <button key={d} className="icon-button" aria-pressed={device === d} title={DEVICE_NAMES[d]} aria-label={DEVICE_NAMES[d]} onClick={() => onDevice(d)}><Icon size={17} /></button> })}
    </div>
    {children}
  </div>
}

/** The words a note points at, as people saw them on the page. */
function Quote({ note }: { note: Pick<SiteNote, 'quote' | 'selector'> }) {
  if (!note.quote && !note.selector) return <p className="note-where">About the whole page</p>
  return <blockquote className="note-quote">{picture(note.selector) ? <><em>A picture</em>{note.quote ? `: ${short(note.quote, 80)}` : ''}</> : note.quote ? short(note.quote) : <em>A part of the page with no words</em>}</blockquote>
}

/** What should change at a spot someone pointed at: a note, new wording, or both. */
export function NoteComposer({ spot, device, target, onSaved, onCancel }: {
  spot: Spot; device: Device; target: { space: string; folder: string }; onSaved: (note: SiteNote) => void; onCancel: () => void
}) {
  const [body, setBody] = useState(''), [suggesting, setSuggesting] = useState(false), [suggestion, setSuggestion] = useState(spot.quote)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const wordy = !!spot.quote && spot.tag !== 'img'
  useEffect(() => { form.current?.scrollIntoView?.({ block: 'nearest' }) }, [])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    const wording = suggesting && suggestion.trim() && suggestion.trim() !== spot.quote ? suggestion.trim() : null
    if (!body.trim() && !wording) { setError(suggesting ? 'Change the wording, or say what should change.' : 'Say what should change.'); return }
    setBusy(true); setError('')
    try { onSaved(await siteApi.addNote({ space_id: target.space, folder: target.folder, page: spot.page, selector: spot.selector, quote: spot.quote,
      x: spot.selector ? spot.x : null, y: spot.selector ? spot.y : null, device, body: body.trim(), suggestion: wording })) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return <form className="note-composer" ref={form} onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
    <h3>New note on {spot.page === '/' ? 'the home page' : spot.page}</h3>
    <Quote note={spot} />
    <label>What should change?<textarea value={body} onChange={e => setBody(e.target.value)} maxLength={5000} rows={3} autoFocus
      placeholder={wordy ? 'For example: this date moved to October 15.' : 'For example: this picture should be the 2026 poster.'} /></label>
    {wordy && <label className="check"><input type="checkbox" checked={suggesting} onChange={e => setSuggesting(e.target.checked)} /> Suggest new wording</label>}
    {wordy && suggesting && <label>New wording<textarea value={suggestion} onChange={e => setSuggestion(e.target.value)} maxLength={5000} rows={4} /></label>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="action-row"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save note'}</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
  </form>
}

/** A website's notes: open ones first, each with its spot, replies, and what can be done with it here. */
export function NotesPanel({ notes, user, here, selected, onShow, onChanged, onApply, onCode, children }: {
  notes: SiteNote[]; user: User; here: string; selected: string; onShow: (note: SiteNote) => void; onChanged: () => void
  onApply?: (note: SiteNote) => void; onCode?: (note: SiteNote) => void; children?: React.ReactNode
}) {
  const [filter, setFilter] = useState<'open' | 'done'>('open'), [thisPage, setThisPage] = useState(false), [error, setError] = useState('')
  const numbered = notes.map((note, i) => ({ note, n: i + 1 }))
  const open = numbered.filter(({ note }) => note.status === 'open'), done = numbered.filter(({ note }) => note.status === 'done')
  const shown = (filter === 'open' ? open : done).filter(({ note }) => !thisPage || samePage(note.page, here))
  useEffect(() => { if (selected) document.getElementById('note-' + selected)?.scrollIntoView?.({ block: 'nearest' }) }, [selected])
  async function act(work: Promise<unknown>) {
    setError('')
    try { await work; onChanged() } catch (e) { setError((e as Error).message) }
  }
  return <section className="notes-panel" aria-label="Notes">
    {children}
    <div className="notes-filter">
      <div role="group" aria-label="Which notes">
        <button className={filter === 'open' ? 'primary' : 'secondary'} aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Open ({open.length})</button>
        <button className={filter === 'done' ? 'primary' : 'secondary'} aria-pressed={filter === 'done'} onClick={() => setFilter('done')}>Done ({done.length})</button>
      </div>
      <label className="check"><input type="checkbox" checked={thisPage} onChange={e => setThisPage(e.target.checked)} /> This page only</label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!shown.length && <p className="muted-text">{filter === 'open' ? (notes.length ? 'No open notes' + (thisPage ? ' on this page.' : '.') : 'No notes yet. Choose Add a note, then click the part of the page you mean.') : 'No notes are done yet.'}</p>}
    <ol className="note-list">{shown.map(({ note, n }) => {
      const mine = note.author_id === user.id, closes = mine || !!user.webmaster
      return <li key={note.id} id={'note-' + note.id} className={'note-card' + (note.id === selected ? ' selected' : '') + (note.status === 'done' ? ' done' : '')}>
        <div className="note-head"><span className="note-number" aria-label={`Note ${n}`}>{n}</span>
          <button className="text-button" onClick={() => onShow(note)} title="Show it on the page">{note.page === '/' ? 'Home' : note.page}{note.device ? ` · ${DEVICE_NAMES[note.device].toLowerCase()}` : ''}</button>
          {note.status === 'done' && <span className="badge">Done</span>}</div>
        <Quote note={note} />
        {note.body && <p className="note-body">{note.body}</p>}
        {note.suggestion && <div className="note-suggestion"><span>Suggested wording</span><p>{note.suggestion}</p></div>}
        <small className="muted-text">{note.author || 'Someone who has left'} · {stamp(note.created)}{note.status === 'done' && note.closed ? ` · done ${stamp(note.closed)}${note.closed_by ? ` by ${note.closed_by}` : ''}` : ''}</small>
        {!!note.replies.length && <ul className="note-replies">{note.replies.map(r => <li key={r.id}><strong>{r.author || 'Someone who has left'}</strong> <small className="muted-text">{stamp(r.created)}</small><p>{r.body}</p></li>)}</ul>}
        <div className="note-actions">
          <button className="secondary" onClick={() => onShow(note)}><LocateFixed size={14} /> Show me</button>
          {onApply && note.suggestion && note.status === 'open' && <button className="secondary" onClick={() => onApply(note)}><Sparkles size={14} /> Use this wording</button>}
          {onCode && <button className="secondary" onClick={() => onCode(note)}><Code size={14} /> Find in code</button>}
          {closes && (note.status === 'open'
            ? <button className="secondary" onClick={() => void act(siteApi.setStatus(note.id, 'done'))}><Check size={14} /> Mark done</button>
            : <button className="secondary" onClick={() => void act(siteApi.setStatus(note.id, 'open'))}><RotateCcw size={14} /> Open again</button>)}
          {closes && <button className="icon-button" aria-label={`Delete note ${n}`} title="Delete" onClick={() => { if (window.confirm('Delete this note and its replies?')) void act(siteApi.deleteNote(note.id)) }}><Trash2 size={15} /></button>}
        </div>
        <ReplyForm onSend={body => act(siteApi.reply(note.id, body))} />
      </li>
    })}</ol>
  </section>
}

function ReplyForm({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false)
  return <form className="reply-form" onSubmit={async e => { e.preventDefault(); if (!text.trim()) return; setBusy(true); await onSend(text.trim()); setText(''); setBusy(false) }}>
    <input aria-label="Reply" placeholder="Reply" value={text} onChange={e => setText(e.target.value)} maxLength={5000} />
    {text.trim() && <button className="secondary" disabled={busy}>Send</button>}
  </form>
}

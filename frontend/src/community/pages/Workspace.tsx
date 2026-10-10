import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ArrowUpRight, Check, Lock, MessageSquare, Trash2, Pencil, X, ChevronLeft, ChevronRight, Send, CalendarDays, ListChecks, StickyNote, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { api, stamp, type Entry, type Kind, type Member, type Space, type User } from '../lib/community'
import { useSpaceRefresh } from '../lib/live'

type Section = 'today' | 'boards' | 'chat' | 'calendar' | 'household' | 'lists' | 'notes'
const kinds: Record<Exclude<Section, 'today'>, Kind> = { boards: 'board', chat: 'chat', calendar: 'event', household: 'task', lists: 'list', notes: 'note' }
const titles: Record<Section, string> = { today: 'Today', boards: 'Boards', chat: 'Chat', calendar: 'Calendar', household: 'Household', lists: 'Lists', notes: 'Notes' }
const hints: Record<Section, string> = { today: 'A little less to keep in your head.', boards: 'Keep the conversation going.', chat: 'A quick word with your people.', calendar: 'Make time for what matters.', household: 'Share the everyday work.', lists: 'One place for all the little things.', notes: 'Give your thoughts a home.' }
const singular: Record<Kind, string> = { board: 'post', chat: 'message', event: 'event', task: 'task', list: 'list', note: 'note', item: 'item', comment: 'reply' }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`

export function Workspace({ section, space, user, search }: { section: Section; space: Space; user: User; search: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Partial<Entry> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [day, setDay] = useState(dateKey(new Date()))
  const [filter, setFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null)
  const root = `/community/spaces/${space.id}`
  async function refresh() {
    const [data, people] = await Promise.all([api<Entry[]>(root + '/entries'), api<Member[]>(root + '/members')])
    setEntries(data); setMembers(people)
  }
  const poll = useRef(async () => {})
  useEffect(() => {
    let active = true
    poll.current = async () => {
      try {
        const [data, people] = await Promise.all([api<Entry[]>(root + '/entries'), api<Member[]>(root + '/members')])
        if (active) { setEntries(data); setMembers(people); setError(''); setLoading(false) }
      } catch (e) { if (active) { setError((e as Error).message); setLoading(false) } }
    }
    void poll.current()
    return () => { active = false }
  }, [root, section])
  useSpaceRefresh(space.id, () => void poll.current(), section === 'chat' ? 3000 : 15000)
  const chatEnd = useRef<HTMLDivElement>(null)
  const chatCount = section === 'chat' ? entries.filter(e => e.kind === 'chat').length : 0
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }) }, [chatCount, loading])
  const activeEntry = entries.find(e => e.id === selected)
  const matching = entries.filter(e => (!search || `${e.title} ${e.body}`.toLowerCase().includes(search.toLowerCase())))
  const items = matching.filter(e => section !== 'today' && e.kind === kinds[section] && !e.parent_id)
  const editable = (entry: Entry) => entry.author_id === user.id || space.role === 'owner' || ['task', 'item'].includes(entry.kind)
  async function save(body: Partial<Entry>) {
    setBusy(true); setError('')
    try {
      const saved = await api<Entry>(root + '/entries' + (body.id ? '/' + body.id : ''), body.id ? 'PUT' : 'POST', body)
      await refresh(); setEditor(null)
      if (['board', 'list', 'note'].includes(saved.kind)) setSelected(saved.id)
      return true
    } catch (e) { setError((e as Error).message); return false } finally { setBusy(false) }
  }
  async function toggle(entry: Entry) { await save({ ...entry, done: !entry.done }) }
  async function remove(entry: Entry) {
    setBusy(true)
    try { await api(root + '/entries/' + entry.id, 'DELETE'); await refresh(); setConfirmDelete(null); if (selected === entry.id) setSelected(null) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const people = (id: string | null) => members.find(m => m.id === id)?.name || 'Unassigned'
  const tasks = entries.filter(e => e.kind === 'task' && !e.done)
  const upcoming = entries.filter(e => e.kind === 'event' && e.due.slice(0,10) >= dateKey(new Date())).sort((a,b) => a.due.localeCompare(b.due))
  const boardPosts = entries.filter(e => e.kind === 'board')
  const calendarCells = useMemo(() => {
    const start = new Date(month); start.setDate(1 - (month.getDay()+6)%7)
    return Array.from({ length: 42 }, (_,i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d })
  }, [month])
  function newEntry(kind: Kind, due = '') { setEditor({ kind, title: '', body: '', visibility: kind === 'note' ? 'private' : 'shared', due, assigned_to: null }) }
  const card = (entry: Entry) => <button className="content-card" key={entry.id} onClick={() => setSelected(entry.id)}>
    <div className="card-meta"><span>{entry.author}</span>{entry.visibility === 'private' && <Lock size={13} />}<span className="push">{new Date(entry.created).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div>
    <h3>{entry.title}</h3><p className="excerpt">{entry.body || (entry.kind === 'list' ? `${entries.filter(e => e.parent_id === entry.id && e.done).length} of ${entries.filter(e => e.parent_id === entry.id).length} done` : 'Open to read more')}</p>
    {entry.kind === 'board' && <span className="card-meta"><MessageSquare size={14} /> {entries.filter(e => e.parent_id === entry.id).length} replies</span>}
  </button>

  return <div className="workspace">
    <div className="page-heading"><div><span className="eyebrow">{space.name}</span><h1>{titles[section]}</h1><p>{hints[section]}</p></div>
      {section !== 'today' && section !== 'chat' && <button className="primary" onClick={() => newEntry(kinds[section], section === 'calendar' ? `${day}T09:00` : '')}><Plus size={17} /> New {singular[kinds[section]]}</button>}
    </div>
    {error && <div className="error" role="alert">{error}<button className="text-button" onClick={() => { void refresh().then(() => setError('')).catch(e => setError(e.message)) }}>Retry</button></div>}
    {loading ? <div className="empty">Loading your space...</div> : <>
      {section === 'today' && (search ? <><h2>Search results</h2><div className="card-grid">{matching.filter(e => !['item','comment','chat'].includes(e.kind)).map(card)}</div>{!matching.some(e => !['item','comment','chat'].includes(e.kind)) && <Empty icon={<Search />} title="Nothing found" />}</> : <>
        <section className="today-banner"><div><span className="eyebrow">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span><h2>Hello, {user.name.split(' ')[0]}.</h2><p>{tasks.length === 1 ? 'One thing to do today.' : tasks.length ? `${tasks.length} things to do. Take them one at a time.` : 'A little room to breathe.'}</p></div><Logo className="banner-mark" /></section>
        <div className="stat-grid">{[['household', 'Open tasks', tasks.length, <ListChecks key="t" />], ['calendar', 'Coming up', upcoming.length, <CalendarDays key="c" />], ['boards', 'Conversations', boardPosts.length, <MessageSquare key="b" />]].map(([path,label,count,icon]) => <Link className="stat-card" to={'/community/'+path} key={String(path)}>{icon}<strong>{count}</strong><span>{label}</span><ArrowUpRight size={16} /></Link>)}</div>
        <div className="today-grid"><section className="panel"><div className="section-heading"><h2>Coming up</h2><Link to="/community/calendar">View calendar <ArrowUpRight size={14} /></Link></div>{upcoming.length ? upcoming.slice(0,4).map(e => <button className="agenda-row" key={e.id} onClick={() => setSelected(e.id)}><div className="date-tile"><b>{new Date(e.due).getDate()}</b><small>{new Date(e.due).toLocaleDateString([], { month: 'short' })}</small></div><span><strong>{e.title}</strong><small>{stamp(e.due)}</small></span></button>) : <Empty icon={<CalendarDays />} title="Your calendar is clear" action="Plan something" onClick={() => newEntry('event', `${dateKey(new Date())}T09:00`)} />}</section>
        <section className="panel"><div className="section-heading"><h2>Around the house</h2><Link to="/community/household">View tasks <ArrowUpRight size={14} /></Link></div>{tasks.length ? tasks.slice(0,5).map(e => <div className="task-row" key={e.id}><button className="check-button" aria-label={`Complete ${e.title}`} onClick={() => toggle(e)} disabled={busy}><Check size={15} /></button><button className="row-title" onClick={() => setSelected(e.id)}>{e.title}<small>{people(e.assigned_to)}</small></button></div>) : <Empty icon={<ListChecks />} title="All caught up" action="Add a task" onClick={() => newEntry('task')} />}</section></div>
        <div className="section-heading"><h2>On the board</h2><Link to="/community/boards">View all <ArrowUpRight size={14} /></Link></div><div className="card-grid">{boardPosts.slice(0,3).map(card)}</div>{!boardPosts.length && <Empty icon={<MessageSquare />} title="Start a conversation" action="Write a post" onClick={() => newEntry('board')} />}
      </>)}
      {['boards','lists','notes'].includes(section) && <><div className="card-grid">{items.map(card)}</div>{!items.length && <Empty icon={section === 'notes' ? <StickyNote /> : section === 'lists' ? <ListChecks /> : <MessageSquare />} title={search ? 'Nothing found' : `Your first ${singular[kinds[section as Exclude<Section,'today'>]]} starts here`} action={search ? undefined : 'Create one'} onClick={() => newEntry(kinds[section as Exclude<Section,'today'>])} />}</>}
      {section === 'household' && <><div className="filter-row">{['all','mine','done'].map(f => <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>{f === 'all' ? 'Open' : f === 'mine' ? 'Assigned to me' : 'Done'}</button>)}</div><section className="panel">{items.filter(e => filter === 'done' ? e.done : !e.done && (filter !== 'mine' || e.assigned_to === user.id)).map(e => <div className="task-row" key={e.id}><button className={'check-button '+(e.done ? 'checked' : '')} onClick={() => toggle(e)} disabled={busy} aria-label={e.done ? `Reopen ${e.title}` : `Complete ${e.title}`}><Check size={15} /></button><button className="row-title" onClick={() => setSelected(e.id)}>{e.title}<small>{people(e.assigned_to)}{e.due ? ` · ${new Date(e.due).toLocaleDateString()}` : ''}</small></button><button className="icon-button" aria-label={`Edit ${e.title}`} onClick={() => setEditor(e)}><Pencil size={15} /></button></div>)}{!items.some(e => filter === 'done' ? e.done : !e.done && (filter !== 'mine' || e.assigned_to === user.id)) && <Empty icon={<Check />} title="Nothing on this list" />}</section></>}
      {section === 'chat' && <section className="chat-panel"><div className="chat-messages" aria-live="polite">{items.slice().reverse().map(e => <div key={e.id} className={'chat-message '+(e.author_id === user.id ? 'own' : '')}><div className="card-meta"><strong>{e.author}</strong><time>{stamp(e.created)}</time>{(e.author_id === user.id || space.role === 'owner') && <button className="icon-button" aria-label="Delete message" onClick={() => setConfirmDelete(e)}><Trash2 size={13} /></button>}</div><p>{e.body}</p></div>)}{!items.length && <Empty icon={<MessageSquare />} title="Say hello" />}<div ref={chatEnd} /></div><QuickForm placeholder="Write a message" label="Send message" busy={busy} onSend={body => save({ kind: 'chat', body, visibility: 'shared' })} /></section>}
      {section === 'calendar' && <div className="calendar-layout"><section className="panel"><div className="section-heading"><button className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft /></button><h2>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2><button className="icon-button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight /></button></div><div className="calendar-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div className="calendar-day-name" key={d}>{d}</div>)}{calendarCells.map(d => <button className={'calendar-cell '+(d.getMonth() !== month.getMonth() ? 'muted ' : '')+(dateKey(d) === day ? 'selected' : '')} key={dateKey(d)} onClick={() => setDay(dateKey(d))}><span className={dateKey(d) === dateKey(new Date()) ? 'today-number' : ''}>{d.getDate()}</span>{items.filter(e => e.due.slice(0,10) === dateKey(d)).slice(0,2).map(e => <small key={e.id}>{e.title}</small>)}{items.filter(e => e.due.slice(0,10) === dateKey(d)).length > 2 && <small>More</small>}</button>)}</div></section><section className="panel agenda"><h2>{new Date(day+'T12:00').toLocaleDateString([], { month: 'long', day: 'numeric' })}</h2>{items.filter(e => e.due.slice(0,10) === day).sort((a,b) => a.due.localeCompare(b.due)).map(e => <button className="agenda-row" key={e.id} onClick={() => setSelected(e.id)}><span><strong>{e.title}</strong><small>{new Date(e.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></span></button>)}<button className="text-button" onClick={() => newEntry('event',day+'T09:00')}><Plus size={16} /> Add event</button></section></div>}
    </>}
    {activeEntry && !editor && <Modal title={activeEntry.title || 'Message'} onClose={() => setSelected(null)}><div className="card-meta"><span>{activeEntry.author}</span><span>{stamp(activeEntry.created)}</span>{activeEntry.visibility === 'private' && <span><Lock size={13} /> Private</span>}</div>{activeEntry.due && <p className="accent-text">{stamp(activeEntry.due)}</p>}<div className="reading-text">{activeEntry.body}</div>
      <div className="action-row">{editable(activeEntry) && <button className="secondary" onClick={() => setEditor(activeEntry)}><Pencil size={14} /> Edit</button>}{(activeEntry.author_id === user.id || space.role === 'owner') && <button className="text-button danger" onClick={() => setConfirmDelete(activeEntry)}><Trash2 size={14} /> Delete</button>}{['board','note'].includes(activeEntry.kind) && <button className="text-button" onClick={() => { setSelected(null); setEditor({ kind: 'task', title: activeEntry.title, body: activeEntry.body, visibility: activeEntry.visibility }) }}><Plus size={14} /> Make a task</button>}</div>
      {['board','list'].includes(activeEntry.kind) && <div className="children"><h3>{activeEntry.kind === 'board' ? 'Replies' : 'Items'}</h3>{entries.filter(e => e.parent_id === activeEntry.id).reverse().map(e => activeEntry.kind === 'list' ? <div className="task-row" key={e.id}><button className={'check-button '+(e.done ? 'checked' : '')} onClick={() => toggle(e)} aria-label={e.done ? `Reopen ${e.title}` : `Complete ${e.title}`}><Check size={15} /></button><span className={e.done ? 'done' : ''}>{e.title}</span>{(e.author_id === user.id || space.role === 'owner') && <button className="icon-button push" aria-label={`Delete ${e.title}`} onClick={() => setConfirmDelete(e)}><Trash2 size={14} /></button>}</div> : <div className="reply" key={e.id}><div className="card-meta"><strong>{e.author}</strong><span>{stamp(e.created)}</span>{(e.author_id === user.id || space.role === 'owner') && <button className="icon-button push" aria-label="Delete reply" onClick={() => setConfirmDelete(e)}><Trash2 size={13} /></button>}</div><p>{e.body}</p></div>)}<QuickForm placeholder={activeEntry.kind === 'board' ? 'Write a reply' : 'Add an item'} label={activeEntry.kind === 'board' ? 'Send reply' : 'Add item'} busy={busy} onSend={text => save({ kind: activeEntry.kind === 'board' ? 'comment' : 'item', title: activeEntry.kind === 'list' ? text : '', body: activeEntry.kind === 'board' ? text : '', parent_id: activeEntry.id, visibility: activeEntry.visibility })} /></div>}
    </Modal>}
    {editor && <Modal title={`${editor.id ? 'Edit' : 'New'} ${singular[editor.kind!]}`} onClose={() => setEditor(null)}><form onSubmit={event => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); void save({ ...editor, ...form, assigned_to: String(form.assigned_to || '') || null } as Partial<Entry>) }}><label>Title<input name="title" defaultValue={editor.title} required maxLength={200} autoFocus /></label><label>{editor.kind === 'board' ? 'Post' : 'Details'}<textarea name="body" rows={editor.kind === 'note' ? 10 : 5} defaultValue={editor.body} maxLength={50000} /></label>{['event','task'].includes(editor.kind!) && <label>{editor.kind === 'event' ? 'When' : 'Due'}<input type="datetime-local" name="due" defaultValue={editor.due} required={editor.kind === 'event'} /></label>}{editor.kind === 'task' && <label>Assigned to<select name="assigned_to" defaultValue={editor.assigned_to || ''}><option value="">Anyone</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}<label>Visibility<select name="visibility" defaultValue={editor.visibility || 'shared'} disabled={Boolean(editor.id)}><option value="shared">Everyone in this space</option><option value="private">Only me</option></select></label>{error && <p className="error" role="alert">{error}</p>}<div className="action-row"><button className="primary" disabled={busy}>{busy ? 'Saving' : 'Save'}</button><button type="button" className="secondary" onClick={() => setEditor(null)}>Cancel</button></div></form></Modal>}
    {confirmDelete && <Modal title="Delete this item?" onClose={() => setConfirmDelete(null)}><p>It will be removed for everyone who can see it.</p><div className="action-row"><button className="danger-button" disabled={busy} onClick={() => remove(confirmDelete)}>Delete</button><button className="secondary" onClick={() => setConfirmDelete(null)}>Keep it</button></div></Modal>}
  </div>
}
export function Empty({ icon, title, action, onClick }: { icon: React.ReactNode; title: string; action?: string; onClick?: () => void }) { return <div className="empty">{icon}<p>{title}</p>{action && <button className="text-button" onClick={onClick}>{action} <ArrowUpRight size={14} /></button>}</div> }
export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  // Callers pass inline closures; keep the latest in a ref so focus is captured and restored only once per open.
  const close = useRef(onClose), dialog = useRef<HTMLElement>(null)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const handler = (e: KeyboardEvent) => {
      // With stacked dialogs, Escape closes only the topmost one.
      const open = document.querySelectorAll('.modal')
      if (e.key === 'Escape' && open[open.length - 1] === dialog.current) close.current()
    }
    document.addEventListener('keydown',handler)
    document.body.classList.add('modal-open')
    return () => { document.removeEventListener('keydown',handler); document.body.classList.remove('modal-open'); previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
    if (e.key !== 'Tab') return
    const focusable = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled),a[href]')
    const first = focusable[0], last = focusable[focusable.length-1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }}><div className="section-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose} autoFocus><X size={20} /></button></div>{children}</section></div>
}
function QuickForm({ placeholder, label, busy, onSend }: { placeholder: string; label: string; busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text,setText] = useState('')
  return <form className="quick-form" onSubmit={async e => { e.preventDefault(); if (text.trim() && await onSend(text.trim())) setText('') }}><input aria-label={placeholder} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} maxLength={placeholder === 'Add an item' ? 200 : 50000} required /><button className="primary" disabled={busy || !text.trim()} aria-label={label}><Send size={17} /></button></form>
}

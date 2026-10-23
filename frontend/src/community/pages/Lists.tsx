import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, ListChecks, Lock, Pencil, Plus, Trash2, Users } from 'lucide-react'
import type { Entry, Member, Space, User } from '../lib/community'
import './lists.css'

type Save = (body: Partial<Entry>) => Promise<Entry | null>
const GROVE = 'grove'
/** Whose tab a list sits on: a private list its author's, a shared one the person it's for, or else the Grove's. */
const keeperOf = (list: Entry) => list.visibility === 'private' ? list.author_id : list.assigned_to || GROVE
const byTitle = (a: Entry, b: Entry) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })

/** Lists, a tab for the Grove's shared ones and a tab for each person's. One list is open at a time, ticked off and edited in place. */
export function Lists({ entries, members, user, space, busy, save, onDelete }: { entries: Entry[]; members: Member[]; user: User; space: Space; busy: boolean; save: Save; onDelete: (entry: Entry) => void }) {
  const [tab, setTab] = useState(GROVE)
  // The list last open on each tab, so coming back finds it again.
  const [open, setOpen] = useState<Record<string, string>>({})
  // People picked from "Someone else" before they have a list.
  const [extra, setExtra] = useState<string[]>([])
  const [fresh, setFresh] = useState('')
  const at = useId()
  const lists = entries.filter(e => e.kind === 'list').sort(byTitle)
  const people = members.filter(m => m.id !== user.id && (extra.includes(m.id) || lists.some(l => keeperOf(l) === m.id)))
  const tabs = [GROVE, user.id, ...people.map(m => m.id)]
  const others = members.filter(m => !tabs.includes(m.id))
  const shown = tabs.includes(tab) ? tab : GROVE
  const name = (id: string) => id === GROVE ? 'Grove' : id === user.id ? 'You' : members.find(m => m.id === id)?.name ?? 'Someone'
  const itemsOf = (list: Entry) => entries.filter(e => e.parent_id === list.id).reverse()
  const left = (list: Entry) => itemsOf(list).filter(e => !e.done).length
  const mine = lists.filter(l => keeperOf(l) === shown)
  const current = mine.find(l => l.id === open[shown]) ?? mine[0]
  const show = (id: string) => { setTab(id); setFresh('') }
  function arrows(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.indexOf(shown), to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 } as Record<string, number | undefined>)[e.key]
    if (to === undefined) return
    e.preventDefault()
    const id = tabs[(to + tabs.length) % tabs.length]
    show(id); document.getElementById(at + id)?.focus()
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget, data = new FormData(form), title = String(data.get('title') ?? '').trim()
    if (!title) return
    const saved = await save({ kind: 'list', title, body: '', visibility: data.get('private') ? 'private' : 'shared', assigned_to: shown === GROVE ? null : shown })
    if (saved) { form.reset(); setOpen(o => ({ ...o, [shown]: saved.id })); setFresh(saved.id) }
  }
  // A list handed to someone else goes with it to their tab.
  function moved(list: Entry) { const to = keeperOf(list); setTab(to); setOpen(o => ({ ...o, [to]: list.id })) }

  return <div className="lists-page">
    <div className="lists-bar">
      <div className="lists-tabs" role="tablist" aria-label="Whose lists" onKeyDown={arrows}>{tabs.map(id => {
        const count = lists.filter(l => keeperOf(l) === id).reduce((n, l) => n + left(l), 0)
        return <button key={id} id={at + id} role="tab" aria-selected={id === shown} aria-controls={at + 'panel'} tabIndex={id === shown ? 0 : -1} className="lists-tab" onClick={() => show(id)}>
          <span className="tab-face" aria-hidden="true">{id === GROVE ? <Users size={14} /> : (id === user.id ? user.name : name(id)).slice(0, 1).toUpperCase()}</span>{name(id)}{count > 0 && <span className="tab-count">{count}</span>}
        </button>
      })}</div>
      {others.length > 0 && <select className="lists-someone" aria-label="Open someone else’s lists" value="" onChange={e => { const id = e.target.value; if (id) { setExtra(x => [...x, id]); show(id) } }}>
        <option value="">+ Someone else</option>{others.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>}
    </div>
    <div className="lists-body" id={at + 'panel'} role="tabpanel" aria-labelledby={at + shown}>
      <div className="list-picker">
        <nav className="list-picks" aria-label={shown === GROVE ? 'The Grove’s lists' : shown === user.id ? 'Your lists' : `${name(shown)}’s lists`}>{mine.map(l => {
          const n = left(l), here = l.id === current?.id
          return <button key={l.id} className={'list-pick' + (here ? ' open' : '')} aria-current={here || undefined} onClick={() => { setOpen(o => ({ ...o, [shown]: l.id })); setFresh('') }}>
            <span>{l.title}</span>{l.visibility === 'private' && <Lock size={12} aria-hidden="true" />}<small>{n ? `${n} left` : itemsOf(l).length ? 'Done' : 'Empty'}</small>
          </button>
        })}</nav>
        <form className="new-list" onSubmit={create}>
          <input name="title" aria-label="New list name" placeholder="New list" maxLength={200} required />
          <button className="secondary" disabled={busy}><Plus size={16} /> Add</button>
          {shown === user.id && <label className="only-me"><input type="checkbox" name="private" /> Only I can see it</label>}
        </form>
      </div>
      {current ? <Sheet key={current.id} list={current} items={itemsOf(current)} members={members} user={user} space={space} focus={fresh === current.id} save={save} onDelete={onDelete} onMoved={moved} />
        : <section className="panel list-none"><ListChecks size={28} aria-hidden="true" /><p>{shown === GROVE ? 'The Grove has no lists yet.' : shown === user.id ? 'You have no lists yet.' : `${name(shown)} has no lists yet.`}</p><p>Name one under New list to start it.</p></section>}
    </div>
  </div>
}

/** One open list: its name and details, the things still to do, and the done ones tucked away. */
function Sheet({ list, items, members, user, space, focus, save, onDelete, onMoved }: { list: Entry; items: Entry[]; members: Member[]; user: User; space: Space; focus: boolean; save: Save; onDelete: (entry: Entry) => void; onMoved: (list: Entry) => void }) {
  const [editing, setEditing] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const keeps = list.author_id === user.id || list.assigned_to === user.id
  const owner = space.role === 'owner'
  const todo = items.filter(e => !e.done), done = items.filter(e => e.done)
  const whose = list.visibility === 'private' ? 'Only you can see this list' : !list.assigned_to ? `Shared by everyone in ${space.name}` : list.assigned_to === user.id ? 'Your list' : `${members.find(m => m.id === list.assigned_to)?.name ?? 'Someone'}’s list`
  async function edit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const saved = await save({ ...list, title: String(data.get('title')), body: String(data.get('body')), assigned_to: list.visibility === 'private' ? list.assigned_to : String(data.get('assigned_to') || '') || null })
    if (!saved) return
    setEditing(false)
    if (keeperOf(saved) !== keeperOf(list)) onMoved(saved)
  }
  const row = (item: Entry) => <Item key={item.id} item={item} save={save} onDelete={onDelete} canDelete={item.author_id === user.id || owner || keeps} />
  return <section className="panel list-sheet" aria-label={list.title}>
    {editing ? <form className="list-form" onSubmit={edit}>
      <label>Name<input name="title" defaultValue={list.title} required maxLength={200} autoFocus /></label>
      <label>Details<textarea name="body" rows={3} defaultValue={list.body} maxLength={50000} placeholder="What this list is for (optional)" /></label>
      {list.visibility === 'shared' ? <label>Whose list<select name="assigned_to" defaultValue={list.assigned_to ?? ''}><option value="">The Grove (everyone)</option>{members.map(m => <option key={m.id} value={m.id}>{m.id === user.id ? `${m.name} (you)` : m.name}</option>)}</select></label>
        : <p className="list-meta"><Lock size={13} aria-hidden="true" /> Only you can see this list.</p>}
      <div className="action-row"><button className="primary">Save</button><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : <div className="list-head">
      <div><h2>{list.title}</h2><p className="list-meta">{list.visibility === 'private' && <Lock size={13} aria-hidden="true" />}{whose} · {done.length} of {items.length} done</p></div>
      {(keeps || owner) && <button className="icon-button" aria-label="Edit list" title="Rename, describe or hand this list to someone" onClick={() => setEditing(true)}><Pencil size={16} /></button>}
      {(list.author_id === user.id || owner) && <button className="icon-button" aria-label="Delete list" onClick={() => onDelete(list)}><Trash2 size={16} /></button>}
    </div>}
    {!editing && list.body && <p className="list-details">{list.body}</p>}
    {todo.length > 0 ? <ul className="list-items">{todo.map(row)}</ul> : <p className="list-empty">{items.length ? 'Everything on this list is done.' : 'Nothing on this list yet.'}</p>}
    <AddItem list={list} focus={focus} save={save} />
    {done.length > 0 && <>
      <button className="text-button list-done-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide done' : `Show ${done.length} done`}</button>
      {showDone && <ul className="list-items">{done.map(row)}</ul>}
    </>}
  </section>
}

/** A thing on a list: tick it off, or click its words to change them (Enter keeps, Escape undoes). */
function Item({ item, canDelete, save, onDelete }: { item: Entry; canDelete: boolean; save: Save; onDelete: (entry: Entry) => void }) {
  const [edit, setEdit] = useState(false)
  async function keep(text: string) {
    const title = text.trim()
    if (title && title !== item.title && !await save({ ...item, title })) return
    setEdit(false)
  }
  return <li className="list-item">
    <button className={'check-button' + (item.done ? ' checked' : '')} aria-label={item.done ? `Reopen ${item.title}` : `Complete ${item.title}`} onClick={() => void save({ ...item, done: !item.done })}><Check size={15} /></button>
    {edit ? <input className="item-input" aria-label={`Change ${item.title}`} defaultValue={item.title} maxLength={200} autoFocus onBlur={e => void keep(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } else if (e.key === 'Escape') { e.currentTarget.value = item.title; e.currentTarget.blur() } }} />
      : <button className={'item-text' + (item.done ? ' done' : '')} aria-label={`Edit ${item.title}`} onClick={() => setEdit(true)}>{item.title}</button>}
    {canDelete && <button className="icon-button" aria-label={`Delete ${item.title}`} onClick={() => onDelete(item)}><Trash2 size={14} /></button>}
  </li>
}

function AddItem({ list, focus, save }: { list: Entry; focus: boolean; save: Save }) {
  const [text, setText] = useState('')
  return <form className="add-item" onSubmit={async e => { e.preventDefault(); const title = text.trim(); if (title && await save({ kind: 'item', title, body: '', parent_id: list.id, visibility: list.visibility })) setText('') }}>
    <input aria-label={`Add to ${list.title}`} placeholder="Add an item" value={text} onChange={e => setText(e.target.value)} maxLength={200} autoFocus={focus} />
    <button className="primary" disabled={!text.trim()}><Plus size={16} /> Add</button>
  </form>
}

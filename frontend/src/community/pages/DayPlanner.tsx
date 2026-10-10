import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api, type Entry, type Space, type User } from '../lib/community'
import { Modal } from './Workspace'
import { useSpaceRefresh } from '../lib/live'
const dayKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const localTime=(day:string,hour=9)=>`${day}T${String(hour).padStart(2,'0')}:00`
const localInput=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':`${dayKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
export function DayPlanner({space,user}:{space:Space;user:User}) {
  const [day,setDay]=useState(()=>dayKey(new Date())), [entries,setEntries]=useState<Entry[]>([])
  const [editor,setEditor]=useState<Partial<Entry>|null>(null),[deleting,setDeleting]=useState<Entry|null>(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
  const hoursRef=useRef<HTMLDivElement>(null)
  const root=`/community/spaces/${space.id}/entries`
  async function refresh(){setEntries(await api<Entry[]>(root))}
  const load=useRef(async()=>{})
  useEffect(()=>{let active=true;load.current=()=>api<Entry[]>(root).then(data=>{if(active){setEntries(data);setLoading(false)}}).catch(e=>{if(active){setError(e.message);setLoading(false)}});void load.current();return()=>{active=false}},[root])
  useSpaceRefresh(space.id,()=>void load.current(),15000)
  useEffect(()=>{if(loading)return;const hour=day===dayKey(new Date())?new Date().getHours():8;const row=hoursRef.current?.querySelector<HTMLElement>(`[data-hour="${hour}"]`);if(row&&hoursRef.current)hoursRef.current.scrollTop=Math.max(0,row.offsetTop-80)},[day,loading])
  const onDay=(e:Entry)=>!!e.due && dayKey(new Date(e.due))===day
  const events=entries.filter(e=>e.kind==='event'&&onDay(e)).sort((a,b)=>a.due.localeCompare(b.due))
  const goals=entries.filter(e=>e.kind==='task'&&(!e.due||onDay(e)))
  const lists=entries.filter(e=>e.kind==='list')
  const editable=(entry:Partial<Entry>)=>!entry.id||entry.author_id===user.id||space.role==='owner'||entry.kind==='task'||entry.kind==='item'
  function add(kind:Entry['kind'],hour=9,parent_id?:string){setEditor({kind,title:'',body:'',visibility:entries.find(e=>e.id===parent_id)?.visibility??'shared',due:['event','task'].includes(kind)?localTime(day,hour):'',parent_id})}
  async function save(form:HTMLFormElement){
    if(!editor)return;const data=Object.fromEntries(new FormData(form));const due=String(data.due||'')
    setBusy(true);setError('')
    try{await api(root+(editor.id?'/'+editor.id:''),editor.id?'PUT':'POST',{...editor,...data,due:due?new Date(due).toISOString():'',version:editor.version});await refresh();setEditor(null)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function toggle(entry:Entry){setBusy(true);setError('');try{await api(root+'/'+entry.id,'PUT',{...entry,done:!entry.done});await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  function move(amount:number){const date=new Date(day+'T12:00');date.setDate(date.getDate()+amount);setDay(dayKey(date))}
  return <div className="workspace planner">
    <div className="page-heading"><div><span className="eyebrow">Your shared day</span><h1>Calendar</h1><p>A little structure, room for what matters.</p></div><button className="primary" onClick={()=>add('event')}><Plus size={16}/>Schedule something</button></div>
    <div className="planner-date"><button className="icon-button" aria-label="Previous day" onClick={()=>move(-1)}><ChevronLeft/></button><label>Date<input type="date" aria-label="Schedule date" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value)}}/></label><button className="icon-button" aria-label="Next day" onClick={()=>move(1)}><ChevronRight/></button><button className="secondary" onClick={()=>setDay(dayKey(new Date()))}>Today</button><span className="muted-text">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span><Link to="/community/month">Month overview</Link></div>
    {error&&<p role="alert" className="error">{error}</p>}
    {loading?<p>Opening your day…</p>:<div className="planner-grid">
      <section className="panel planner-hours" aria-label="Hourly schedule"><div className="section-heading"><h2>{new Date(day+'T12:00').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</h2><span className="muted-text">{events.length} scheduled</span></div>
        <div className="planner-time-window" ref={hoursRef}>{Array.from({length:24},(_,hour)=><div className="planner-hour" key={hour} data-hour={hour}><button className="planner-hour-add" aria-label={`Schedule at ${String(hour).padStart(2,'0')}:00`} onClick={()=>add('event',hour)}>{new Date(day+`T${String(hour).padStart(2,'0')}:00`).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}<Plus size={12}/></button><div>{events.filter(e=>new Date(e.due).getHours()===hour).map(event=><button key={event.id} className="planner-event" onClick={()=>setEditor({...event,due:localInput(event.due)})}><small>{new Date(event.due).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small><strong>{event.title}</strong>{event.body&&<span>{event.body}</span>}</button>)}</div></div>)}</div>
      </section>
      <aside className="planner-focus"><section className="panel"><div className="section-heading"><h2>Goals &amp; tasks</h2><button className="icon-button" aria-label="Add daily goal" onClick={()=>add('task')}><Plus/></button></div><p className="muted-text">{goals.filter(e=>e.done).length} of {goals.length} complete · Includes unscheduled tasks</p>{goals.map(goal=><div className="task-row" key={goal.id}><button className={'check-button '+(goal.done?'checked':'')} disabled={busy} aria-label={`${goal.done?'Reopen':'Complete'} ${goal.title}`} onClick={()=>void toggle(goal)}><Check size={15}/></button><button className={'row-title '+(goal.done?'done':'')} onClick={()=>setEditor({...goal,due:goal.due?localInput(goal.due):''})}>{goal.title}</button></div>)}{!goals.length&&<p className="muted-text">Choose one thing to move forward today.</p>}</section>
        <section className="panel"><div className="section-heading"><h2>Your lists</h2><button className="icon-button" aria-label="Add list" onClick={()=>add('list')}><Plus/></button></div>{lists.map(list=><div className="planner-list" key={list.id}><h3>{list.title}</h3>{entries.filter(e=>e.kind==='item'&&e.parent_id===list.id).map(item=><div className="task-row" key={item.id}><button className={'check-button '+(item.done?'checked':'')} disabled={busy} aria-label={`${item.done?'Reopen':'Complete'} ${item.title}`} onClick={()=>void toggle(item)}><Check size={15}/></button><span className={item.done?'done':''}>{item.title}</span></div>)}<button className="text-button" onClick={()=>add('item',9,list.id)}>Add to {list.title}</button></div>)}{!lists.length&&<p className="muted-text">Keep the small steps beside your schedule.</p>}</section>
      </aside>
    </div>}
    {editor&&<Modal title={editor.id?editor.title||'Details':editor.kind==='event'?'Schedule something':editor.kind==='task'?'Daily goal':editor.kind==='list'?'New list':'List item'} onClose={()=>setEditor(null)}><form onSubmit={e=>{e.preventDefault();void save(e.currentTarget)}}><label>Title<input name="title" required maxLength={200} defaultValue={editor.title} readOnly={!editable(editor)}/></label><label>Details<textarea name="body" maxLength={50000} defaultValue={editor.body} readOnly={!editable(editor)}/></label>{['event','task'].includes(editor.kind!)&&<label>{editor.kind==='event'?'When':'Target time'}<input name="due" type="datetime-local" defaultValue={editor.due} required={editor.kind==='event'} readOnly={!editable(editor)}/></label>}<label>Visibility<select aria-label="Visibility" name="visibility" defaultValue={editor.visibility} disabled={!!editor.id||!!editor.parent_id}><option value="shared">Everyone in this space</option><option value="private">Only me</option></select></label>{error&&<p className="error" role="alert">{error}</p>}<div className="action-row">{editable(editor)&&<button className="primary" disabled={busy}>Save</button>}<button type="button" className="secondary" onClick={()=>setEditor(null)}>Close</button>{editor.id&&(editor.author_id===user.id||space.role==='owner')&&<button type="button" className="danger-button" onClick={()=>setDeleting(editor as Entry)}>Delete</button>}</div></form></Modal>}
    {deleting&&<Modal title="Delete this item?" onClose={()=>setDeleting(null)}><p>Remove {deleting.title} from this space?</p><button className="danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api(root+'/'+deleting.id,'DELETE');await refresh();setDeleting(null);setEditor(null)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>Delete</button></Modal>}
  </div>
}

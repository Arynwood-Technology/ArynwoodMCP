import { useEffect, useMemo, useState, useRef } from 'react'
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type Entry, type Member, type Space, type User } from '../lib/community'
import { Modal } from './Workspace'
import { Lists } from './Lists'
import { useSpaceRefresh } from '../lib/live'
const dayKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const localTime=(day:string,hour=9)=>`${day}T${String(hour).padStart(2,'0')}:00`
const localInput=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':`${dayKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
export function DayPlanner({space,user}:{space:Space;user:User}) {
  const [day,setDay]=useState(()=>dayKey(new Date())), [entries,setEntries]=useState<Entry[]>([]), [members,setMembers]=useState<Member[]>([])
  const [month,setMonth]=useState(()=>{const now=new Date();return new Date(now.getFullYear(),now.getMonth(),1)})
  const [editor,setEditor]=useState<Partial<Entry>|null>(null),[deleting,setDeleting]=useState<Entry|null>(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
  const hoursRef=useRef<HTMLDivElement>(null)
  const root=`/community/spaces/${space.id}/entries`
  const people=`/community/spaces/${space.id}/members`
  async function refresh(){const [data,list]=await Promise.all([api<Entry[]>(root),api<Member[]>(people)]);setEntries(data);setMembers(list)}
  const load=useRef(async()=>{})
  useEffect(()=>{let active=true;load.current=()=>Promise.all([api<Entry[]>(root),api<Member[]>(people)]).then(([data,list])=>{if(active){setEntries(data);setMembers(list);setLoading(false)}}).catch(e=>{if(active){setError(e.message);setLoading(false)}});void load.current();return()=>{active=false}},[root,people])
  useSpaceRefresh(space.id,()=>void load.current(),15000)
  useEffect(()=>{if(loading)return;const hour=day===dayKey(new Date())?new Date().getHours():8;const row=hoursRef.current?.querySelector<HTMLElement>(`[data-hour="${hour}"]`);if(row&&hoursRef.current)hoursRef.current.scrollTop=Math.max(0,row.offsetTop-80)},[day,loading])
  const onDay=(e:Entry)=>!!e.due && dayKey(new Date(e.due))===day
  const events=entries.filter(e=>e.kind==='event'&&onDay(e)).sort((a,b)=>a.due.localeCompare(b.due))
  const goals=entries.filter(e=>e.kind==='task'&&(!e.due||onDay(e)))
  const assignee=(id:string|null)=>members.find(m=>m.id===id)?.name
  const editable=(entry:Partial<Entry>)=>!entry.id||entry.author_id===user.id||space.role==='owner'||entry.kind==='task'||entry.kind==='item'
  function add(kind:Entry['kind'],hour=9){setEditor({kind,title:'',body:'',visibility:'shared',due:['event','task'].includes(kind)?localTime(day,hour):''})}
  async function save(form:HTMLFormElement){
    if(!editor)return;const data=Object.fromEntries(new FormData(form));const due=String(data.due||'')
    setBusy(true);setError('')
    const assigned=editor.kind==='task'?{assigned_to:String(data.assigned_to||'')||null}:{}
    try{await api(root+(editor.id?'/'+editor.id:''),editor.id?'PUT':'POST',{...editor,...data,...assigned,due:due?new Date(due).toISOString():'',version:editor.version});await refresh();setEditor(null)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  // Lists save as they're edited, in place.
  async function keep(body:Partial<Entry>){setBusy(true);setError('');try{const saved=await api<Entry>(root+(body.id?'/'+body.id:''),body.id?'PUT':'POST',body);await refresh();return saved}catch(e){setError((e as Error).message);return null}finally{setBusy(false)}}
  async function toggle(entry:Entry){setBusy(true);setError('');try{await api(root+'/'+entry.id,'PUT',{...entry,done:!entry.done});await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  // Six weeks from the Monday on or before the 1st, so every month fits the same grid.
  const cells=useMemo(()=>{const start=new Date(month);start.setDate(1-(month.getDay()+6)%7);return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d})},[month])
  const scheduled=(key:string)=>entries.filter(e=>e.kind==='event'&&!!e.due&&dayKey(new Date(e.due))===key).sort((a,b)=>a.due.localeCompare(b.due))
  // Choosing a day shows its schedule, and brings its month into view.
  function pick(key:string){setDay(key);const d=new Date(key+'T12:00');setMonth(m=>m.getFullYear()===d.getFullYear()&&m.getMonth()===d.getMonth()?m:new Date(d.getFullYear(),d.getMonth(),1))}
  function move(amount:number){const date=new Date(day+'T12:00');date.setDate(date.getDate()+amount);pick(dayKey(date))}
  const today=dayKey(new Date())
  return <div className="workspace planner">
    <div className="page-heading"><div><span className="eyebrow">{space.name}</span><h1>Calendar</h1><p>The month at a glance, with the day beside it.</p></div><button className="primary" onClick={()=>add('event')}><Plus size={16}/>Schedule something</button></div>
    {error&&<p role="alert" className="error">{error}</p>}
    {loading?<p>Opening your calendar…</p>:<div className="planner-board">
      <div className="planner-main">
        <section className="panel planner-month" aria-label="Month"><div className="section-heading"><button className="icon-button" aria-label="Previous month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft/></button><h2>{month.toLocaleDateString([],{month:'long',year:'numeric'})}</h2><button className="icon-button" aria-label="Next month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight/></button><button className="secondary planner-today" onClick={()=>pick(today)}>Today</button></div>
          <div className="calendar-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div className="calendar-day-name" key={d}>{d}</div>)}{cells.map(d=>{const key=dayKey(d),on=scheduled(key);return <button key={key} className={'calendar-cell '+(d.getMonth()!==month.getMonth()?'muted ':'')+(key===day?'selected':'')} aria-pressed={key===day} aria-label={d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})+(on.length?`, ${on.length} scheduled`:'')} onClick={()=>pick(key)}><span className={key===today?'today-number':''}>{d.getDate()}</span>{on.slice(0,2).map(e=><small key={e.id}>{e.title}</small>)}{on.length>2&&<small>+{on.length-2} more</small>}</button>})}</div>
        </section>
        <div className="planner-focus"><section className="panel"><div className="section-heading"><h2>Goals &amp; tasks</h2><button className="icon-button" aria-label="Add daily goal" onClick={()=>add('task')}><Plus/></button></div><p className="muted-text">{goals.filter(e=>e.done).length} of {goals.length} complete · Includes unscheduled tasks</p>{goals.map(goal=><div className="task-row" key={goal.id}><button className={'check-button '+(goal.done?'checked':'')} disabled={busy} aria-label={`${goal.done?'Reopen':'Complete'} ${goal.title}`} onClick={()=>void toggle(goal)}><Check size={15}/></button><button className={'row-title '+(goal.done?'done':'')} onClick={()=>setEditor({...goal,due:goal.due?localInput(goal.due):''})}>{goal.title}{assignee(goal.assigned_to)&&<small>{goal.assigned_to===user.id?'You':assignee(goal.assigned_to)}</small>}</button></div>)}{!goals.length&&<p className="muted-text">Choose one thing to move forward today.</p>}</section>
        <section className="panel planner-lists"><div className="section-heading"><h2>Lists</h2><Link to="/community/lists">All lists <ArrowUpRight size={14}/></Link></div><Lists entries={entries} members={members} user={user} space={space} busy={busy} save={keep} onDelete={setDeleting}/></section></div>
      </div>
      <section className="panel planner-hours" aria-label="Hourly schedule"><div className="section-heading"><button className="icon-button" aria-label="Previous day" onClick={()=>move(-1)}><ChevronLeft/></button><h2>{new Date(day+'T12:00').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</h2><button className="icon-button" aria-label="Next day" onClick={()=>move(1)}><ChevronRight/></button></div>
        <p className="muted-text">{events.length} scheduled · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <div className="planner-time-window" ref={hoursRef}>{Array.from({length:24},(_,hour)=><div className="planner-hour" key={hour} data-hour={hour}><button className="planner-hour-add" aria-label={`Schedule at ${String(hour).padStart(2,'0')}:00`} onClick={()=>add('event',hour)}>{new Date(day+`T${String(hour).padStart(2,'0')}:00`).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}<Plus size={12}/></button><div>{events.filter(e=>new Date(e.due).getHours()===hour).map(event=><button key={event.id} className="planner-event" onClick={()=>setEditor({...event,due:localInput(event.due)})}><small>{new Date(event.due).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small><strong>{event.title}</strong>{event.body&&<span>{event.body}</span>}</button>)}</div></div>)}</div>
      </section>
    </div>}
    {editor&&<Modal title={editor.id?editor.title||'Details':editor.kind==='event'?'Schedule something':editor.kind==='task'?'Daily goal':'Details'} onClose={()=>setEditor(null)}><form onSubmit={e=>{e.preventDefault();void save(e.currentTarget)}}><label>Title<input name="title" required maxLength={200} defaultValue={editor.title} readOnly={!editable(editor)}/></label><label>Details<textarea name="body" maxLength={50000} defaultValue={editor.body} readOnly={!editable(editor)}/></label>{['event','task'].includes(editor.kind!)&&<label>{editor.kind==='event'?'When':'Target time'}<input name="due" type="datetime-local" defaultValue={editor.due} required={editor.kind==='event'} readOnly={!editable(editor)}/></label>}{editor.kind==='task'&&<label>Assigned to<select name="assigned_to" defaultValue={editor.assigned_to??''} disabled={!editable(editor)}><option value="">Anyone</option>{members.filter(m=>editor.visibility!=='private'||m.id===user.id).map(m=><option key={m.id} value={m.id}>{m.id===user.id?`${m.name} (you)`:m.name}</option>)}</select></label>}<label>Visibility<select aria-label="Visibility" name="visibility" defaultValue={editor.visibility} disabled={!!editor.id||!!editor.parent_id} onChange={e=>{const visibility=e.target.value as Entry['visibility'];setEditor(current=>current&&{...current,visibility})}}><option value="shared">Everyone in this space</option><option value="private">Only me</option></select></label>{error&&<p className="error" role="alert">{error}</p>}<div className="action-row">{editable(editor)&&<button className="primary" disabled={busy}>Save</button>}<button type="button" className="secondary" onClick={()=>setEditor(null)}>Close</button>{editor.id&&(editor.author_id===user.id||space.role==='owner')&&<button type="button" className="danger-button" onClick={()=>setDeleting(editor as Entry)}>Delete</button>}</div></form></Modal>}
    {deleting&&<Modal title="Delete this item?" onClose={()=>setDeleting(null)}><p>Remove {deleting.title} from this space?</p><button className="danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api(root+'/'+deleting.id,'DELETE');await refresh();setDeleting(null);setEditor(null)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>Delete</button></Modal>}
  </div>
}

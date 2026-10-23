import { BrandLogo, BrandLinks, BrandCredit } from './components/Brand'
import { useContext, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, FolderOpen, Globe, Hash, LayoutDashboard, ListChecks, ListTodo, Mail as MailIcon, Menu, MessageCircle, MessagesSquare, Newspaper, Palette, Plus, ShieldCheck, Sparkles, StickyNote, UserPlus, Users, X, type LucideIcon } from 'lucide-react'
import { api, type Space, type User } from './lib/community'
import { GroveContext, groveUrl } from './lib/grove'
import { useBrand, brandStyle } from './lib/brand'
import { PublicInviteLink } from './components/PublicInviteLink'
import { Welcome } from './pages/Welcome'
import { Modal, Workspace } from './pages/Workspace'
import { Settings } from './pages/Settings'
import { DayPlanner } from './pages/DayPlanner'
import { IRC } from './pages/IRC'
import { Mail } from './pages/Mail'
import { Admin } from './pages/Admin'
import { FileBank } from './pages/FileBank'
import { Webmaster } from './pages/Webmaster'
import { LookAndFeel } from './pages/LookAndFeel'
import { Messages } from './pages/Messages'
import { WorkspaceSetup } from './pages/WorkspaceSetup'
import { WishLamp } from './components/WishLamp'
import { notify, notifyPrefs, OPEN } from './lib/notify'
import { ircDisconnect } from './lib/irc-manager'
import { useLiveRefresh, useSpaceRefresh } from './lib/live'
import { messagesApi } from './lib/messages'
import { siteSearch, siteTarget } from './lib/site'
import { useAppStore as useCommunityStore } from './store/useAppStore'
import './community.css'
// Arynwood only: fits the members' page into the Community page (see the file).
import './arynwood.css'
const sections=['calendar','today','boards','discussion','household','lists','notes','settings','month','irc','mail','admin','files','website','look','inbox','setup'] as const
type Section=typeof sections[number]
type Item=readonly [Section,string,LucideIcon,boolean?]
/** The menu, in groups a newcomer can find their way around: talking, organizing, and running the Grove. An item whose last value is false isn't offered. */
const menuGroups=(user:User,space:Space|undefined,logName:string):[string,Item[]][]=>[
  ['Talk',([['irc','Public chat',Hash,!!user.host_tools||!!user.public_chat],['inbox','Messages',MessageCircle],['discussion',logName,Newspaper],['boards','Board',MessagesSquare],['mail','Mail',MailIcon,!!user.host_tools]] as Item[]).filter(i=>i[3]!==false)],
  ['Organize',[['today','Overview',LayoutDashboard],['calendar','Calendar',CalendarDays],['household','Tasks',ListTodo],['lists','Lists',ListChecks],['notes','Notes',StickyNote],['files','Files',FolderOpen]]],
  ['Settings',([['settings','People & identity',Users],['admin','Grove admin',ShieldCheck,user.role!=='member'],['look','Look & feel',Palette,user.role==='owner'],['setup','Workspace setup',Sparkles,space?.role==='owner']] as Item[]).filter(i=>i[3]!==false)],
]
export function Community() {
  const brand=useBrand()
  const location=useLocation(), navigate=useNavigate()
  const consumedInvite=useRef('')
  const grove=useContext(GroveContext)
  const [dialog,setDialog]=useState<'create'|'invite'|null>(null),[busy,setBusy]=useState(false),[dialogError,setDialogError]=useState(''),[inviteLink,setInviteLink]=useState(''),[copied,setCopied]=useState(false)
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false)
  const [spaces,setSpaces]=useState<Space[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [unread,setUnread]=useState(0)
  // The menu, when it slides over the page: on a phone, and in the site editor.
  const [drawer,setDrawer]=useState(false),closeButton=useRef<HTMLButtonElement>(null)
  useEffect(()=>{if(!drawer)return;closeButton.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setDrawer(false)};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[drawer])
  // Set on a server (GROVE_PUBLIC_URL): the address members on other computers use.
  const [publicUrl,setPublicUrl]=useState<string|null>(null)
  useEffect(()=>{let active=true;api<{public_url?:string|null}>('/auth/status').then(s=>{if(active)setPublicUrl(s?.public_url??null)}).catch(()=>{});return()=>{active=false}},[])
  useEffect(()=>{let active=true;api<User>('/auth/me').then(u=>{if(active)setUser(u)}).catch(()=>{}).finally(()=>{if(active)setReady(true)});return()=>{active=false}},[])
  // A clicked notification brings its page forward.
  useEffect(()=>{const go=(e:Event)=>navigate((e as CustomEvent<string>).detail);window.addEventListener(OPEN,go);return()=>window.removeEventListener(OPEN,go)},[navigate])
  useEffect(()=>{const expired=()=>{ircDisconnect();useCommunityStore.setState(useCommunityStore.getInitialState(),true);setUser(null);setSpaces([]);setDialog(null);setInviteLink('')};window.addEventListener('session-expired',expired);return()=>window.removeEventListener('session-expired',expired)},[])
  useEffect(()=>{
    if(!user)return
    let active=true
    const token=new URLSearchParams(location.search).get('invite')
    async function load(){
      try{
        if(token&&consumedInvite.current!==token){
          consumedInvite.current=token
          try{
            const joined=await api<Space>('/community/join','POST',{token})
            if(active){setSelected(joined.id);navigate('/community/calendar',{replace:true})}
          }catch(e){if(active)setError((e as Error).message)}
        }
        const updated=await api<Space[]>('/community/spaces')
        if(active)setSpaces(updated)
      }catch(e){if(active)setError((e as Error).message)}
    }
    void load()
    return()=>{active=false}
  },[user,location.search,navigate])
  // A rename, a new topic or role, or a space deleted or left elsewhere: refetch the list. A space
  // that has gone falls back to the first one left.
  async function reloadSpaces(){
    try{const updated=await api<Space[]>('/community/spaces');if(space&&!updated.some(s=>s.id===space.id))setNotice(`You no longer have access to ${space.name}. It was deleted, or you were removed.`);setSpaces(updated)}
    catch{/* the open page reports its own errors */}
  }
  function openDialog(kind:'create'|'invite'){setDialogError('');setInviteLink('');setCopied(false);setDialog(kind)}
  async function createSpace(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setDialogError('')
    const name=String(new FormData(event.currentTarget).get('name')??'').trim()
    if(!name){setDialogError('Enter a space name.');setBusy(false);return}
    try{const created=await api<Space>('/community/spaces','POST',{name});setSpaces(list=>[...list,created]);setSelected(created.id);setDialog(null);navigate('/community/calendar')}
    catch(e){setDialogError((e as Error).message)}finally{setBusy(false)}
  }
  async function createInvite(){
    if(!space)return;setBusy(true);setDialogError('')
    try{const result=await api<{token:string;url?:string|null}>(`/community/spaces/${space.id}/invites`,'POST');setInviteLink(result.url??`${grove.url}/community?invite=${encodeURIComponent(result.token)}`)}
    catch(e){setDialogError((e as Error).message)}finally{setBusy(false)}
  }
  async function copyInvite(){try{await navigator.clipboard.writeText(inviteLink);setCopied(true)}catch{setDialogError('Select the invitation link and copy it manually.')}}
  const logout=async()=>{try{await api('/auth/logout','POST');ircDisconnect();useCommunityStore.setState(useCommunityStore.getInitialState(),true);setUser(null);setSpaces([]);setDialog(null);setInviteLink('')}catch(e){setError((e as Error).message)}}
  const requested=location.pathname.split('/')[2]
  // /community/messages was the host's peer-to-peer inbox, now gone: it opens Messages.
  const section=requested==='chat'?'discussion':requested==='messages'?'inbox':sections.find(s=>s===requested)??'calendar'
  const space=spaces.find(s=>s.id===selected)??spaces[0]
  // Public chat is the host's own IRC client, unless the Grove opens a room to every member (GROVE_CHAT_CHANNEL).
  const hostPage=section==='mail'||(section==='irc'&&!user?.public_chat)
  const logName=user?.log_name||'Updates'
  const here=(s:string)=>section===s||(s==='calendar'&&section==='month')
  const titles:Record<Section,string>={calendar:'Calendar',month:'Calendar',today:'Overview',boards:'Board',discussion:logName,household:'Tasks',lists:'Lists',notes:'Notes',settings:'People & identity',irc:'Public chat',mail:'Mail',admin:'Grove admin',files:'Files',website:user?.webmaster?'Webmaster tools':'Website preview',look:'Look & feel',inbox:'Messages',setup:'Workspace setup'}
  // The site editor wants the whole width: there the menu waits behind its button.
  const studio=section==='website'&&siteTarget(location.search)?.mode==='edit'
  const temporary=!!user?.admin&&!!publicUrl&&/(\.sslip\.io|\.nip\.io|^[\d.]+|^\[.*\])$/.test(new URL(publicUrl).hostname)
  return <div className="grove-community" style={brandStyle(brand)}>
    {!ready?<div className="workspace"><p>Opening Community…</p></div>:!user?<Welcome brand={brand} onLogin={async(u,usedInvite)=>{
      if(usedInvite){consumedInvite.current=new URLSearchParams(location.search).get('invite')??'';navigate('/community/calendar',{replace:true})}
      setUser(u)
    }}/>:<>
      <div className={'grove-shell'+(drawer?' menu-open':'')+(studio?' focus':'')}>
        <aside className="sidebar" id="grove-menu" aria-label="Menu">
          <div className="sidebar-top"><div className="community-brand"><BrandLogo brand={brand}/><span className="eyebrow tagline">{brand.branded&&<strong>{brand.name}<br/></strong>}{brand.tagline}</span></div><button ref={closeButton} className="icon-button menu-close" aria-label="Close menu" onClick={()=>setDrawer(false)}><X size={20}/></button></div>
          {brand.branded&&<><BrandLinks brand={brand}/><BrandCredit/></>}
          <div className="space-picker"><label htmlFor="space-choice">Space</label><select id="space-choice" value={space?.id??''} onChange={e=>{setSelected(e.target.value);setNotice('')}}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{space?.topic&&<p className="space-topic">{space.topic}</p>}
            <div className="space-actions">{space?.role==='owner'&&<><button className="primary" onClick={()=>{setDrawer(false);openDialog('invite')}}><UserPlus size={15}/>Invite members</button><NavLink className="text-button" to="/community/settings" onClick={()=>setDrawer(false)}>Manage space</NavLink></>}{user.can_start_spaces&&<button className="text-button" onClick={()=>{setDrawer(false);openDialog('create')}}><Plus size={15}/>Create new space</button>}</div></div>
          <NavLink to="/community/website" className={()=>'site-card'+(section==='website'?' active':'')} onClick={()=>setDrawer(false)}><Globe size={22}/><span><strong>{user.webmaster?'Webmaster tools':'Website preview'}</strong><small>{user.webmaster?'Edit and publish the website':'See the website and leave notes'}</small></span></NavLink>
          <nav aria-label="Community sections">{menuGroups(user,space,logName).map(([caption,items])=>items.length>0&&<div className="nav-group" key={caption}><p className="nav-caption">{caption}</p>{items.map(([s,label,Icon])=><NavLink key={s} to={'/community/'+s} className={()=>here(s)?'active':''} onClick={()=>setDrawer(false)}><Icon size={17}/>{label}{s==='inbox'&&unread>0&&<span className="nav-badge" aria-label={`${unread} unread`}>{unread}</span>}</NavLink>)}</div>)}</nav>
          <div className="sidebar-bottom"><span className="avatar small" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span><span className="who" title={user.email}><strong>{user.name}</strong><small>{space?.role==='owner'?'Space owner':'Member'}{user.admin?' · Host':''}</small></span><button className="text-button push" onClick={()=>void logout()}>Sign out</button></div>
          <p className="storage-note">{publicUrl?`Community storage: this Grove's server (${new URL(publicUrl).host}), shared live with your members`:brand.branded?'Community storage: this Grove’s server':grove.local?'Community storage: this computer':`Community storage: ${new URL(grove.url).host}`}</p>
        </aside>
        <div className="menu-scrim" onClick={()=>setDrawer(false)}/>
        <div className="shell-main">
          <div className="topbar shell-topbar"><button className="icon-button menu-button" aria-label="Open menu" aria-expanded={drawer} aria-controls="grove-menu" onClick={()=>setDrawer(true)}><Menu size={20}/></button><strong className="topbar-title">{titles[section]}</strong>{unread>0&&section!=='inbox'&&<NavLink className="nav-badge" to="/community/inbox" aria-label={`Messages: ${unread} unread`}>{unread}</NavLink>}</div>
          {(temporary||section==='discussion'||(hostPage&&user.host_tools)||error||notice)&&<div className="shell-notes">
            {temporary&&<p className="notice">This Grove is on a temporary address. <NavLink to="/community/settings">Use your own domain</NavLink></p>}
            {section==='discussion'&&<p className="muted-text">{logName} is where news and updates for everyone in this space go.{(user.public_chat||user.host_tools)&&' For conversation, use Public chat.'}</p>}
            {hostPage&&user.host_tools&&<p className="muted-text">{section==='irc'?'Public chat is IRC, with your own network nickname and account. Connect explicitly; your Grove sign-in does not authenticate an IRC identity.':'Mail uses the host’s configured mailbox, separate from your Grove account.'} These connections currently belong to the host.</p>}
            {error&&<p role="alert" className="error">{error}</p>}
            {notice&&<p role="status" className="notice">{notice}</p>}
          </div>}
      {hostPage&&!user.host_tools?<div className="workspace"><p>{user.admin?'Mail and Public chat are switched off on this Grove.':'Host access required. Shared calendars, plans, and discussions are available to space members.'}</p></div>:section==='irc'?<div className="community-connection"><IRC chat={user.public_chat}/></div>:section==='mail'?<div className="community-connection"><Mail/></div>:section==='inbox'?<Messages user={user}/>:section==='look'?(user.role==='owner'?<LookAndFeel/>:<div className="workspace"><p>Only this Grove’s owners change how it looks.</p></div>):section==='website'?<Webmaster user={user} spaces={spaces} current={space?.id} open={siteTarget(location.search)} onShow={target=>navigate('/community/website'+siteSearch(target))} onOpen={(id,folder)=>{setSelected(id);navigate('/community/files?folder='+encodeURIComponent(folder))}}/>:section==='admin'?(user.role==='member'?<div className="workspace"><p>Only this Grove’s owners and managers can open Grove admin.</p></div>:<Admin user={user} onChanged={()=>void api<User>('/auth/me').then(setUser).catch(()=>{})}/>):space?section==='setup'?(space.role==='owner'?<WorkspaceSetup key={space.id} space={space}/>:<div className="workspace"><p>Space owner access required.</p></div>):section==='settings'?<Settings key={space.id} space={space} user={user} onLogout={logout} onLeft={(id,note)=>{setSpaces(list=>list.filter(s=>s.id!==id));setNotice(note)}} onChanged={()=>void reloadSpaces()}/>:section==='calendar'||section==='month'?<DayPlanner key={space.id} space={space} user={user}/>:section==='files'?<FileBank key={space.id+location.search} space={space} user={user} startFolder={new URLSearchParams(location.search).get('folder')??''}/>:<Workspace key={space.id} section={section==='discussion'?'chat':section as 'today'|'boards'|'household'|'lists'|'notes'} space={space} user={user} search="" mark={brand.branded?brand.logo_url:undefined}/>:<div className="workspace"><p>{user.can_start_spaces?'Create a new space, or open an invitation to join one.':'Open an invitation to join a space.'}</p></div>}
        </div>
        {space&&<WatchSpace key={space.id} id={space.id} onChange={()=>void reloadSpaces()}/>}
        <WatchInbox onCount={setUnread}/>
      </div>
      <WishLamp page={section} spaceId={space?.id}/>
      {dialog&&<Modal title={dialog==='create'?'Create new space':'Invite members'} onClose={()=>{if(!busy)setDialog(null)}}>
        {dialog==='create'?<form onSubmit={createSpace}>
          <label>Space name<input name="name" required maxLength={80} placeholder="Home, team, or project" /></label>
          <p className="muted-text">Start with a private space. Invite people when you are ready to share its calendar, plans, and discussions.</p>
          {dialogError&&<p role="alert" className="error">{dialogError}</p>}
          <div className="action-row"><button className="primary" disabled={busy}>{busy?'Creating…':'Create space'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button></div>
        </form>:<>
          <p>Invite someone to <strong>{space?.name}</strong>.</p>
          <p className="muted-text">Each link admits one person and expires after seven days. Send it privately. They sign in or create their own account to join.</p>
          {!publicUrl&&<p className="muted-text">This Grove has no public address yet, so the link opens only on this computer. Set GROVE_PUBLIC_URL on the server to invite people elsewhere.</p>}
          {!inviteLink?<button className="primary" disabled={busy} onClick={()=>void createInvite()}>{busy?'Creating…':'Create invitation link'}</button>:<div className="invite-box"><input readOnly aria-label="Invite link" value={inviteLink} onFocus={e=>e.currentTarget.select()}/><button className="secondary" onClick={()=>void copyInvite()}>{copied?'Copied':'Copy link'}</button></div>}
          {dialogError&&<p role="alert" className="error">{dialogError}</p>}
          {space&&<PublicInviteLink spaceId={space.id}/>}
          <div className="action-row"><button className="secondary" disabled={busy} onClick={()=>setDialog(null)}>Done</button><NavLink className="secondary" to="/community/settings" onClick={()=>setDialog(null)}>View members</NavLink></div>
        </>}
      </Modal>}
    </>}
  </div>
}
function WatchSpace({id,onChange}:{id:string;onChange:()=>void}){useSpaceRefresh(id,onChange,30000);return null}
// Unread messages, for the menu's count: only while someone is signed in.
// A new one notifies, when the person asked to be told and isn't reading Messages already.
function WatchInbox({onCount}:{onCount:(n:number)=>void}){
  const seen=useRef<number|null>(null)
  const tell=()=>void messagesApi.conversations().then(list=>{const c=list.filter(c=>c.unread&&!c.last_from_me).sort((a,b)=>b.updated.localeCompare(a.updated))[0];if(c)notify(c.with.name,c.last||'New message','/community/inbox','grove-message-'+c.id)}).catch(()=>{})
  const load=()=>{messagesApi.unread().then(v=>{const before=seen.current;seen.current=v.unread;onCount(v.unread)
    if(before!==null&&v.unread>before&&notifyPrefs().messages&&(document.hidden||!window.location.pathname.startsWith('/community/inbox')))tell()}).catch(()=>{})}
  useEffect(load,[])// eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(groveUrl('/messages/events'),load,30000);return null
}

import { useContext, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, Hash, Radio, MessageSquare, UserRound } from 'lucide-react'
import { api, type Space, type User } from './lib/community'
import { GroveContext } from './lib/grove'
import { Logo } from './components/Logo'
import { PublicInviteLink } from './components/PublicInviteLink'
import { Welcome } from './pages/Welcome'
import { Modal, Workspace } from './pages/Workspace'
import { Settings } from './pages/Settings'
import { DayPlanner } from './pages/DayPlanner'
import { IRC } from './pages/IRC'
import { P2PChat } from './pages/P2PChat'
import { Mail } from './pages/Mail'
import { ircDisconnect } from './lib/irc-manager'
import { useAppStore as useCommunityStore } from './store/useAppStore'
import './community.css'
const sections=['calendar','today','boards','discussion','household','lists','notes','settings','month','irc','messages','mail'] as const
const nav=[['calendar','Calendar',CalendarDays],['irc','IRC rooms',Hash],['messages','Private messages',Radio],['discussion','Space discussion',MessageSquare]] as const
export function Community() {
  const location=useLocation(), navigate=useNavigate()
  const consumedInvite=useRef('')
  const grove=useContext(GroveContext)
  const [dialog,setDialog]=useState<'create'|'invite'|null>(null),[busy,setBusy]=useState(false),[dialogError,setDialogError]=useState(''),[inviteLink,setInviteLink]=useState(''),[copied,setCopied]=useState(false)
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false)
  const [spaces,setSpaces]=useState<Space[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState('')
  const [peerVisited,setPeerVisited]=useState(false)
  // Set on a server (GROVE_PUBLIC_URL): the address members on other computers use.
  const [publicUrl,setPublicUrl]=useState<string|null>(null)
  useEffect(()=>{let active=true;api<{public_url?:string|null}>('/auth/status').then(s=>{if(active)setPublicUrl(s?.public_url??null)}).catch(()=>{});return()=>{active=false}},[])
  useEffect(()=>{let active=true;api<User>('/auth/me').then(u=>{if(active)setUser(u)}).catch(()=>{}).finally(()=>{if(active)setReady(true)});return()=>{active=false}},[])
  useEffect(()=>{const expired=()=>{ircDisconnect();useCommunityStore.setState(useCommunityStore.getInitialState(),true);setUser(null);setSpaces([]);setDialog(null);setInviteLink('');setPeerVisited(false)};window.addEventListener('session-expired',expired);return()=>window.removeEventListener('session-expired',expired)},[])
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
  const logout=async()=>{try{await api('/auth/logout','POST');ircDisconnect();useCommunityStore.setState(useCommunityStore.getInitialState(),true);setUser(null);setSpaces([]);setDialog(null);setInviteLink('');setPeerVisited(false)}catch(e){setError((e as Error).message)}}
  const requested=location.pathname.split('/')[2]
  const section=requested==='chat'?'discussion':sections.find(s=>s===requested)??'calendar'
  const space=spaces.find(s=>s.id===selected)??spaces[0]
  // Peer messages stay connected once opened, so remember the first visit (it mounts P2PChat for good).
  if(section==='messages'&&user?.admin&&!peerVisited)setPeerVisited(true)
  const hostPage=['irc','messages','mail'].includes(section)
  return <div className="grove-community">
    {!ready?<div className="workspace"><p>Opening Community…</p></div>:!user?<Welcome onLogin={async(u,usedInvite)=>{
      if(usedInvite){consumedInvite.current=new URLSearchParams(location.search).get('invite')??'';navigate('/community/calendar',{replace:true})}
      setUser(u)
    }}/>:<>
      <header className="workspace community-header"><div className="section-heading"><div><div className="community-brand"><Logo label="Arynwood tree logo"/><span className="eyebrow tagline">The Grove, your community – your choices</span></div><h2>{space?.name??'Community'}</h2><div className="community-identity"><UserRound size={15}/><strong>{user.name}</strong><span>{user.email}</span><span>· {space?.role==='owner'?'Space owner':'Member'}{user.admin?' · Host':''}</span></div></div><button className="secondary" onClick={()=>void logout()}>Sign out</button></div>
        <div className="action-row"><label>Space <select value={space?.id??''} onChange={e=>setSelected(e.target.value)}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="secondary" onClick={()=>openDialog('create')}>Create new space</button>{space?.role==='owner'&&<button className="primary" onClick={()=>openDialog('invite')}>Invite members</button>}</div>
        {!!user.admin&&publicUrl&&/(\.sslip\.io|\.nip\.io|^[\d.]+|^\[.*\])$/.test(new URL(publicUrl).hostname)&&<p className="notice">This Grove is on a temporary address. <NavLink to="/community/settings">Use your own domain</NavLink></p>}
        <p className="muted-text">{publicUrl?`Community storage: this Grove's server (${new URL(publicUrl).host}), shared live with your members`:grove.local?'Community storage: this computer':`Community storage: ${new URL(grove.url).host}`}</p>
        <nav className="community-nav" aria-label="Community sections">{nav.filter(([s])=>user.admin||!['irc','messages'].includes(s)).map(([s,label,Icon])=><NavLink key={s} to={'/community/'+s} className={()=>section===s||(s==='calendar'&&section==='month')?'primary':'secondary'}><Icon size={15}/>{label}</NavLink>)}{(['today','boards','household','lists','notes','settings'] as const).map(s=><NavLink key={s} to={'/community/'+s} className={()=>section===s?'primary':'secondary'}>{({today:'Overview',boards:'Board',household:'Tasks',lists:'Lists',notes:'Notes',settings:'People & identity'})[s]}</NavLink>)}{!!user.admin&&<NavLink to="/community/mail" className={()=>section==='mail'?'primary':'secondary'}>Mail</NavLink>}</nav>
        {section==='discussion'&&<p className="muted-text" style={{marginTop:14}}>A shared message board for members of this space. For IRC conversations, use IRC rooms. For peer messages and photos, use Private messages.</p>}
        {hostPage&&<p className="muted-text" style={{marginTop:14}}>{section==='irc'?'IRC uses your network nickname and account. Connect explicitly; your Grove sign-in does not authenticate an IRC identity.':section==='messages'?'NKN messages use your peer address. Verify a contact’s address before sharing photos; a contact label is only a name you chose.':'Mail uses the host’s configured mailbox, separate from your Grove account.'} These connections currently belong to the host.</p>}
        {error&&<p role="alert" className="error">{error}</p>}
      </header>
      {hostPage&&!user.admin?<div className="workspace"><p>Host access required. Shared calendars, plans, and discussions are available to space members.</p></div>:section==='irc'?<div className="community-connection"><IRC/></div>:section==='mail'?<div className="community-connection"><Mail/></div>:section==='messages'?null:space?section==='settings'?<Settings key={space.id} space={space} user={user} onLogout={logout} onLeft={id=>setSpaces(list=>list.filter(s=>s.id!==id))}/>:section==='calendar'?<DayPlanner key={space.id} space={space} user={user}/>:<Workspace key={space.id} section={section==='month'?'calendar':section==='discussion'?'chat':section as 'today'|'boards'|'household'|'lists'|'notes'} space={space} user={user} search=""/>:<div className="workspace"><p>Create a new space, or open an invitation to join one.</p></div>}
      {!!user.admin&&peerVisited&&<div className="community-connection" hidden={section!=='messages'}><P2PChat/></div>}
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

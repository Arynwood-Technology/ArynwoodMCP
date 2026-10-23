import { useContext, useEffect, useState } from 'react'
import { Copy, Plus, Download, LogOut, UserMinus, KeyRound, Mail, Hash, Trash2 } from 'lucide-react'
import { api, type Member, type Space, type User } from '../lib/community'
import { Modal } from './Workspace'
import { useSpaceRefresh } from '../lib/live'
import { PublicInviteLink } from '../components/PublicInviteLink'
import { GroveAddress } from '../components/GroveAddress'
import { NotifyPanel } from '../components/NotifySettings'
import { GroveContext, groveUrl } from '../lib/grove'
import { downloadFile } from '../../lib/download'

interface Connections { mail: boolean; smtp: boolean; version: string }

export function Settings({ space, user, onLogout, onLeft, onChanged }: { space: Space; user: User; onLogout: () => Promise<void>; onLeft: (id: string, note: string) => void; onChanged: () => void }) {
  const [link, setLink] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [removing, setRemoving] = useState<Member | null>(null), [steppingDown, setSteppingDown] = useState(false)
  const [connections, setConnections] = useState<Connections | null>(null)
  const owner = space.role === 'owner'
  const owners = members.filter(m => m.role === 'owner').length
  const grove = useContext(GroveContext)
  const [exporting, setExporting] = useState(false)
  const root = `/community/spaces/${space.id}`

  useEffect(() => {
    api<Member[]>(root + '/members').then(setMembers).catch(e => setError(e.message))
    if (user.admin) api<Connections>('/community/connections').then(setConnections).catch(() => {})
  }, [root, user.admin])
  // People joining or leaving from other computers appear without a reload.
  useSpaceRefresh(space.id, () => { api<Member[]>(root + '/members').then(setMembers).catch(() => {}) }, 30000)

  const flash = (text: string) => { setMessage(text); setError('') }
  const fail = (e: unknown) => { setError((e as Error).message); setMessage('') }

  async function invite() {
    try { const result = await api<{ token: string; url?: string | null }>(root + '/invites', 'POST'); setLink(result.url ?? `${grove.url}/community?invite=${result.token}`); flash('Invite created. It works once and expires in seven days.') }
    catch (e) { fail(e) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); flash('Link copied.') }
    catch { flash('Select the link and copy it.') }
  }
  async function remove(member: Member) {
    try {
      await api(`${root}/members/${member.id}`, 'DELETE')
      setRemoving(null)
      if (member.id === user.id) { onLeft(space.id, `You left ${space.name}.`); return }
      setMembers(list => list.filter(m => m.id !== member.id)); flash(`${member.name} was removed.`)
    } catch (e) { setRemoving(null); fail(e) }
  }
  async function changeRole(member: Member, role: Member['role']) {
    try {
      await api(`${root}/members/${member.id}`, 'PUT', { role })
      setSteppingDown(false)
      setMembers(list => list.map(m => m.id === member.id ? { ...m, role } : m))
      flash(member.id === user.id ? 'You are now a member. Another owner can make you an owner again.' : role === 'owner' ? `${member.name} is now an owner and can manage this space.` : `${member.name} is now a member.`)
      if (member.id === user.id) onChanged()
    } catch (e) { setSteppingDown(false); fail(e) }
  }

  return <div className="workspace">
    <div className="page-heading"><div><span className="eyebrow">{space.name}</span><h1>Settings</h1><p>Signed in as {user.email}</p></div><button className="secondary" onClick={onLogout}><LogOut size={15} /> Sign out</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="settings-grid">
      {owner && <SpacePanel space={space} members={members.length} onSaved={text => { flash(text); onChanged() }} onDeleted={() => onLeft(space.id, `${space.name} was deleted.`)} />}
      <section className="panel">
        <h2>People</h2>
        <ul className="member-list">{members.map(m => <li key={m.id}>
          <span className="avatar small" aria-hidden="true">{m.name.charAt(0).toUpperCase()}</span>
          <span className="who"><strong>{m.name}{m.id === user.id ? ' (you)' : ''}</strong>{!owner && <small>{m.role === 'owner' ? 'Owner' : 'Member'}</small>}</span>
          {owner && <select className="role-select push" aria-label={`Role for ${m.name}`} value={m.role} disabled={m.id === user.id && owners < 2} title={m.id === user.id && owners < 2 ? 'A space needs an owner. Make someone else an owner first.' : undefined}
            onChange={e => { const role = e.target.value as Member['role']; if (m.id === user.id) setSteppingDown(true); else void changeRole(m, role) }}>
            <option value="owner">Owner</option><option value="member">Member</option></select>}
          {owner && m.id !== user.id && <button className="icon-button" aria-label={`Remove ${m.name}`} title="Remove from space" onClick={() => setRemoving(m)}><UserMinus size={16} /></button>}
        </li>)}</ul>
        {owner ? <>
          <p className="muted-text">Owners can rename or delete the space, invite people, and change who else is an owner.</p>
          <p>Share a link with someone you trust. It works once and expires in seven days.</p>
          <button className="primary" onClick={invite}><Plus size={16} /> Create invite</button>
          {link && <div className="invite-box"><input readOnly aria-label="Invite link" value={link} onFocus={e => e.currentTarget.select()} /><button className="secondary" onClick={copy}><Copy size={14} /> Copy</button></div>}
          <PublicInviteLink spaceId={space.id} />
        </> : <p className="muted-text">Only owners can invite people.</p>}
        {owner && owners < 2 ? <p className="muted-text">You are the only owner. To leave, make someone else an owner first, or delete the space.</p>
          : <button className="text-button danger" onClick={() => setRemoving(members.find(m => m.id === user.id) ?? { id: user.id, name: user.name, role: space.role })}><UserMinus size={15} /> Leave this space</button>}
      </section>
      {!!user.admin && <GroveAddress />}
      <section className="panel">
        <h2>Your identity</h2>
        <p><strong>{user.name}</strong> · {user.email}</p>
        <p className="muted-text">Your Grove account signs you into this space with email and password. Email ownership has not been verified. Your space role controls shared plans and membership.</p>
        <p className="muted-text">Public chat (IRC) nicknames are a separate identity. A display name does not prove who a person is; confirm their account through a trusted conversation.</p>
      </section>
      <NotifyPanel />
      <section className="panel">
        <h2>Your data</h2>
        <p>Download a portable copy of this space, including your private notes.</p>
        {/* Saved through a blob: the desktop web view ignores `download` on another origin's link. */}
        <button className="secondary button-link" disabled={exporting} onClick={() => { setExporting(true); downloadFile(groveUrl(root + '/export'), 'community-export.json').then(() => flash('Space exported.')).catch(fail).finally(() => setExporting(false)) }}><Download size={16} /> {exporting ? 'Exporting…' : 'Export space'}</button>
      </section>
      <PasswordPanel onDone={flash} />
      {user.admin ? <section className="panel">
        <h2>Connections</h2>
        <p>{user.host_tools ? 'Mail and Public chat run on this computer and are visible only to the host.' : `${user.public_chat ? 'Mail is' : 'Mail and Public chat are'} switched off on this Grove.${user.public_chat ? ` Public chat is open to every member, in ${user.public_chat.channel}.` : ''} Mail sending is used only to email wishes.`}</p>
        <ul className="status-list">
          {user.host_tools && <li><Mail size={16} /><span>Mail reading</span><b className={connections?.mail ? 'ok' : ''}>{connections === null ? '...' : connections.mail ? 'Ready' : 'Not set up'}</b></li>}
          <li><Mail size={16} /><span>Mail sending</span><b className={connections?.smtp ? 'ok' : ''}>{connections === null ? '...' : connections.smtp ? 'Ready' : 'Not set up'}</b></li>
          {user.host_tools && <li><Hash size={16} /><span>Public chat</span><b className="ok">Connect from Public chat</b></li>}
        </ul>
        {user.host_tools && connections && !connections.mail && <p className="muted-text">Add mail settings to <code>.env</code> and restart to read mail over IMAP. Without them, local Thunderbird mailboxes are used when available.</p>}
        {connections && <p className="muted-text">Version {connections.version}</p>}
      </section> : null}
    </div>
    {removing && <Modal title={removing.id === user.id ? 'Leave this space?' : `Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
      <p>{removing.id === user.id ? 'You will lose access until someone invites you again.' : 'They will lose access to this space. What they wrote stays.'}</p>
      <div className="action-row"><button className="danger-button" onClick={() => remove(removing)}>{removing.id === user.id ? 'Leave' : 'Remove'}</button><button className="secondary" onClick={() => setRemoving(null)}>Cancel</button></div>
    </Modal>}
    {steppingDown && <Modal title="Stop being an owner?" onClose={() => setSteppingDown(false)}>
      <p>You will stay in {space.name} as a member, and no longer manage it or its people. Another owner can make you an owner again.</p>
      <div className="action-row"><button className="danger-button" onClick={() => void changeRole(members.find(m => m.id === user.id) ?? { id: user.id, name: user.name, role: 'owner' }, 'member')}>Become a member</button><button className="secondary" onClick={() => setSteppingDown(false)}>Cancel</button></div>
    </Modal>}
  </div>
}

function SpacePanel({ space, members, onSaved, onDeleted }: { space: Space; members: number; onSaved: (text: string) => void; onDeleted: () => void }) {
  const root = `/community/spaces/${space.id}`
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false), [confirm, setConfirm] = useState(''), [deleteError, setDeleteError] = useState('')
  async function remove(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setDeleteError('')
    try { await api(root, 'DELETE'); onDeleted() }
    catch (e) { setDeleteError((e as Error).message); setBusy(false) }
  }
  return <section className="panel">
    <h2>This space</h2>
    {/* Keyed by what is saved, so a change another owner makes shows here instead of being overwritten. */}
    <form key={`${space.name}\n${space.topic ?? ''}`} onSubmit={async e => {
      e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget))
      setBusy(true); setError('')
      try { await api(root, 'PUT', { name: String(data.name ?? ''), topic: String(data.topic ?? '') }); onSaved('Space saved.') }
      catch (err) { setError((err as Error).message) } finally { setBusy(false) }
    }}>
      <label>Name<input name="name" required maxLength={80} defaultValue={space.name} /></label>
      <label>Topic<input name="topic" maxLength={300} defaultValue={space.topic ?? ''} placeholder="What this space is for, or what is happening now" aria-describedby="space-topic-hint" /></label><small id="space-topic-hint">Everyone in the space sees it under the name.</small>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="action-row"><button className="secondary" disabled={busy}>{busy && !deleting ? 'Saving' : 'Save'}</button></div>
    </form>
    <div className="danger-zone">
      <h3>Delete this space</h3>
      <p className="muted-text">Deletes it for everyone, with its calendar, tasks, lists, notes, board and discussion.</p>
      <button className="secondary danger" onClick={() => { setConfirm(''); setDeleteError(''); setDeleting(true) }}><Trash2 size={14} /> Delete space</button>
    </div>
    {deleting && <Modal title={`Delete ${space.name}?`} onClose={() => { if (!busy) setDeleting(false) }}>
      <p>{members > 1 ? `All ${members} members lose` : 'You lose'} this space and everything in it: calendar, tasks, lists, notes, board and discussion. This cannot be undone.</p>
      <p className="muted-text">To keep a copy, export the space first (Your data).</p>
      <form onSubmit={remove}>
        <label>Type the space name to confirm<input aria-label="Space name to confirm" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" placeholder={space.name} /></label>
        {deleteError && <p className="error" role="alert">{deleteError}</p>}
        <div className="action-row"><button className="danger-button" disabled={busy || confirm.trim() !== space.name}>{busy ? 'Deleting…' : 'Delete space'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button></div>
      </form>
    </Modal>}
  </section>
}

function PasswordPanel({ onDone }: { onDone: (text: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <section className="panel">
    <h2><KeyRound size={18} /> Password</h2>
    <form onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget, data = Object.fromEntries(new FormData(form))
      if (data.password !== data.confirm) { setError('The new passwords do not match.'); return }
      setBusy(true); setError('')
      try { await api('/auth/password', 'POST', { current: data.current, password: data.password }); form.reset(); onDone('Password changed. Other devices were signed out.') }
      catch (err) { setError((err as Error).message) } finally { setBusy(false) }
    }}>
      <label>Current password<input type="password" name="current" autoComplete="current-password" required maxLength={256} /></label>
      <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      <label>Confirm new password<input type="password" name="confirm" autoComplete="new-password" required minLength={12} maxLength={256} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="action-row"><button className="secondary" disabled={busy}>{busy ? 'Saving' : 'Change password'}</button></div>
    </form>
  </section>
}

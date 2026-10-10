import { useContext, useEffect, useState } from 'react'
import { Copy, Plus, Download, LogOut, UserMinus, KeyRound, Mail, Hash, Radio } from 'lucide-react'
import { api, type Member, type Space, type User } from '../lib/community'
import { Modal } from './Workspace'
import { useSpaceRefresh } from '../lib/live'
import { PublicInviteLink } from '../components/PublicInviteLink'
import { GroveAddress } from '../components/GroveAddress'
import { GroveContext, groveUrl } from '../lib/grove'
import { downloadFile } from '../../lib/download'

interface Connections { mail: boolean; smtp: boolean; version: string }

export function Settings({ space, user, onLogout, onLeft }: { space: Space; user: User; onLogout: () => Promise<void>; onLeft: (id: string) => void }) {
  const [link, setLink] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [removing, setRemoving] = useState<Member | null>(null)
  const [connections, setConnections] = useState<Connections | null>(null)
  const owner = space.role === 'owner'
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
      if (member.id === user.id) { onLeft(space.id); return }
      setMembers(list => list.filter(m => m.id !== member.id)); flash(`${member.name} was removed.`)
    } catch (e) { setRemoving(null); fail(e) }
  }

  return <div className="workspace">
    <div className="page-heading"><div><span className="eyebrow">{space.name}</span><h1>Settings</h1><p>Signed in as {user.email}</p></div><button className="secondary" onClick={onLogout}><LogOut size={15} /> Sign out</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="settings-grid">
      <section className="panel">
        <h2>People</h2>
        <ul className="member-list">{members.map(m => <li key={m.id}>
          <span className="avatar small" aria-hidden="true">{m.name.charAt(0).toUpperCase()}</span>
          <span className="who"><strong>{m.name}{m.id === user.id ? ' (you)' : ''}</strong><small>{m.role === 'owner' ? 'Owner' : 'Member'}</small></span>
          {owner && m.role !== 'owner' && <button className="icon-button push" aria-label={`Remove ${m.name}`} title="Remove from space" onClick={() => setRemoving(m)}><UserMinus size={16} /></button>}
        </li>)}</ul>
        {owner ? <>
          <p>Share a link with someone you trust. It works once and expires in seven days.</p>
          <button className="primary" onClick={invite}><Plus size={16} /> Create invite</button>
          {link && <div className="invite-box"><input readOnly aria-label="Invite link" value={link} onFocus={e => e.currentTarget.select()} /><button className="secondary" onClick={copy}><Copy size={14} /> Copy</button></div>}
          <PublicInviteLink spaceId={space.id} />
        </> : <>
          <p className="muted-text">Only the space owner can invite people.</p>
          <button className="text-button danger" onClick={() => setRemoving(members.find(m => m.id === user.id) ?? { id: user.id, name: user.name, role: 'member' })}><UserMinus size={15} /> Leave this space</button>
        </>}
      </section>
      {!!user.admin && <GroveAddress />}
      <section className="panel">
        <h2>Your identity</h2>
        <p><strong>{user.name}</strong> · {user.email}</p>
        <p className="muted-text">Your Grove account signs you into this space with email and password. Email ownership has not been verified. Your space role controls shared plans and membership.</p>
        <p className="muted-text">IRC nicknames and NKN peer addresses are separate identities. A display name does not prove who a person is; confirm their account or address through a trusted conversation.</p>
      </section>
      <section className="panel">
        <h2>Your data</h2>
        <p>Download a portable copy of this space, including your private notes.</p>
        {/* Saved through a blob: the desktop web view ignores `download` on another origin's link. */}
        <button className="secondary button-link" disabled={exporting} onClick={() => { setExporting(true); downloadFile(groveUrl(root + '/export'), 'community-export.json').then(() => flash('Space exported.')).catch(fail).finally(() => setExporting(false)) }}><Download size={16} /> {exporting ? 'Exporting…' : 'Export space'}</button>
      </section>
      <PasswordPanel onDone={flash} />
      {user.admin ? <section className="panel">
        <h2>Connections</h2>
        <p>Mail, IRC and Message run on this computer and are visible only to the host.</p>
        <ul className="status-list">
          <li><Mail size={16} /><span>Mail reading</span><b className={connections?.mail ? 'ok' : ''}>{connections === null ? '...' : connections.mail ? 'Ready' : 'Not set up'}</b></li>
          <li><Mail size={16} /><span>Mail sending</span><b className={connections?.smtp ? 'ok' : ''}>{connections === null ? '...' : connections.smtp ? 'Ready' : 'Not set up'}</b></li>
          <li><Hash size={16} /><span>IRC</span><b className="ok">Connect from IRC rooms</b></li>
          <li><Radio size={16} /><span>Message</span><b className="ok">Open Private messages</b></li>
        </ul>
        {connections && !connections.mail && <p className="muted-text">Add mail settings to <code>.env</code> and restart to read mail over IMAP. Without them, local Thunderbird mailboxes are used when available.</p>}
        {connections && <p className="muted-text">Version {connections.version}</p>}
      </section> : null}
    </div>
    {removing && <Modal title={removing.id === user.id ? 'Leave this space?' : `Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
      <p>{removing.id === user.id ? 'You will lose access until someone invites you again.' : 'They will lose access to this space. What they wrote stays.'}</p>
      <div className="action-row"><button className="danger-button" onClick={() => remove(removing)}>{removing.id === user.id ? 'Leave' : 'Remove'}</button><button className="secondary" onClick={() => setRemoving(null)}>Cancel</button></div>
    </Modal>}
  </div>
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

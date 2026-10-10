import { useContext, useEffect, useState } from 'react'
import { Copy, Link2Off, RefreshCw } from 'lucide-react'
import { api } from '../lib/community'
import { GroveContext } from '../lib/grove'

interface LinkState { token: string | null; url?: string | null }

/** A space's reusable invite link: anyone who has it can join, until the owner turns it off. */
export function PublicInviteLink({ spaceId }: { spaceId: string }) {
  const root = `/community/spaces/${spaceId}/invite-link`
  // undefined while loading; a null token when the space has no public link
  const [state, setState] = useState<LinkState | undefined>(undefined)
  const grove = useContext(GroveContext)
  const link = state === undefined ? undefined : state.token ? state.url ?? `${grove.url}/community?invite=${encodeURIComponent(state.token)}` : null
  const setLink = (value: null) => setState({ token: value })
  const [busy, setBusy] = useState(false), [note, setNote] = useState(''), [error, setError] = useState('')
  const show = (r: LinkState) => setState(r)
  useEffect(() => {
    let active = true
    api<LinkState>(root).then(r => { if (active) setState(r) }).catch(e => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [root])
  async function create() {
    setBusy(true); setError(''); setNote('')
    try { const replacing = Boolean(link); show(await api<LinkState>(root, 'POST')); setNote(replacing ? 'New link created. The old one no longer works.' : 'Public link created.') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function turnOff() {
    setBusy(true); setError(''); setNote('')
    try { await api(root, 'DELETE'); setLink(null); setNote('Public link turned off. It no longer works.') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link ?? ''); setNote('Link copied.') }
    catch { setNote('Select the link and copy it.') }
  }
  return <section className="public-link" aria-label="Public invite link">
    <h3>Public invite link</h3>
    <p className="muted-text">Anyone who has this link can join the space and see what its members share. Post it where your friends will find it, and turn it off when you are done.</p>
    {link === undefined ? null : link ? <>
      <div className="invite-box"><input readOnly aria-label="Public invite link address" value={link} onFocus={e => e.currentTarget.select()} /><button className="secondary" onClick={() => void copy()}><Copy size={14} /> Copy</button></div>
      <div className="action-row"><button className="secondary" disabled={busy} onClick={() => void create()}><RefreshCw size={14} /> New link</button><button className="secondary danger" disabled={busy} onClick={() => void turnOff()}><Link2Off size={14} /> Turn off</button></div>
    </> : <button className="secondary" disabled={busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Create public link'}</button>}
    {note && <p className="notice" role="status">{note}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}

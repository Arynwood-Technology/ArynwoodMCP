import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe } from 'lucide-react'
import { api } from '../lib/community'

interface Address { address: string | null; host: string | null; temporary: boolean; server_ip: string | null; can_change: boolean
  pending: string | null; result: { status: 'done' | 'failed'; domain: string; message: string; finished?: number } | null }
interface Lookup { domain: string; addresses: string[]; points_here: boolean; record: { type: string; name: string; value: string | null } }

/** Host only: move the Grove from its first (often temporary) address to the host's own domain. */
export function GroveAddress() {
  const [info, setInfo] = useState<Address | null>(null), [lookup, setLookup] = useState<Lookup | null>(null)
  const [domain, setDomain] = useState(''), [email, setEmail] = useState(''), [confirming, setConfirming] = useState(false)
  const [moving, setMoving] = useState(''), [movedTo, setMovedTo] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  const misses = useRef(0)
  // When the address was last read: how old a failed move is, without reading the clock during render.
  const [checkedAt, setCheckedAt] = useState(0)
  useEffect(() => { api<Address>('/grove-setup/address').then(a => { setInfo(a); setCheckedAt(Date.now()); if (a.pending) setMoving(a.pending) }).catch(e => setError((e as Error).message)) }, [])
  // While the server moves, ask how it is going. Once it has moved, this address may only forward.
  useEffect(() => {
    if (!moving) return
    const timer = setInterval(() => {
      api<Address>('/grove-setup/address').then(a => {
        misses.current = 0; setInfo(a); setCheckedAt(Date.now())
        if (!a.pending && a.result?.domain === moving) { if (a.result.status === 'done') setMovedTo(moving); setMoving('') }
      }).catch(() => { if (++misses.current >= 3) { setMovedTo(moving); setMoving('') } })
    }, 3000)
    return () => clearInterval(timer)
  }, [moving])

  async function check(event?: React.FormEvent) {
    event?.preventDefault(); setBusy(true); setError(''); setConfirming(false)
    try { setLookup(await api<Lookup>('/grove-setup/check-domain', 'POST', { domain })) } catch (e) { setLookup(null); setError((e as Error).message) } finally { setBusy(false) }
  }
  async function move() {
    if (!lookup) return
    setBusy(true); setError('')
    try { await api('/grove-setup/domain', 'POST', { domain: lookup.domain, email }); misses.current = 0; setInfo(i => i && { ...i, result: null }); setMoving(lookup.domain); setConfirming(false) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { /* the value stays selectable */ } }

  if (!info) return error ? <section className="panel"><h2>Your Grove's address</h2><p className="error" role="alert">{error}</p></section> : null
  const scheme = info.address?.split('://')[0] ?? location.protocol.replace(':', '')
  // A failed attempt is worth showing for a while; a finished move is announced in the page that made it.
  const failed = info.result?.status === 'failed' && checkedAt / 1000 - (info.result.finished ?? 0) < 3600 ? info.result : null
  return <section className="panel grove-address" aria-label="Your Grove's address">
    <h2><Globe size={18} /> Your Grove's address</h2>
    <p>Members open <strong>{info.address ?? 'this computer only'}</strong>{info.temporary && info.address ? ' — a temporary address' : ''}.</p>
    {!info.can_change ? <p className="muted-text">This Grove's address is set on its server (GROVE_PUBLIC_URL in its settings).</p> : <>
      {moving ? <p className="notice" role="status">Moving your Grove to {moving}. This takes about a minute; keep this page open.</p>
      : movedTo ? <p className="notice" role="status">Your Grove is now at <a href={`${scheme}://${movedTo}/community`}>{scheme}://{movedTo}</a>. Open it there and sign in again; the old address forwards to it.</p>
      : <>
        {failed && <p className="error" role="alert">Moving to {failed.domain} did not work: {failed.message} Nothing was changed.</p>}
        <p className="muted-text">Make the Grove your own space at a domain you own, such as grove.yourname.com. You'll add one DNS record where you bought the domain, then switch here; the certificate for HTTPS is set up for you.</p>
        <form onSubmit={check} className="address-form">
          <label>Your domain<input value={domain} onChange={e => { setDomain(e.target.value); setLookup(null) }} placeholder="grove.example.com" required maxLength={253} autoComplete="off" spellCheck={false} /></label>
          <label>Email for certificate notices (optional)<input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} autoComplete="email" /></label>
          <button className="secondary" disabled={busy}>{busy && !lookup ? 'Checking…' : lookup ? 'Check again' : 'Check'}</button>
        </form>
        {lookup && <div className="dns-check">
          <p>At your domain provider, add this DNS record:</p>
          <table className="dns-record"><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
            <tbody><tr><td>A</td><td>{lookup.record.name}</td><td>{lookup.record.value ?? "this server's IP address (see your VPS provider's panel)"}
              {lookup.record.value && <button className="icon-button" aria-label="Copy IP address" title="Copy" onClick={() => void copy(lookup.record.value!)}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}</td></tr></tbody></table>
          {lookup.points_here ? <p className="notice" role="status">{lookup.domain} points to this server.</p>
            : lookup.addresses.length ? <p className="muted-text">{lookup.domain} points to {lookup.addresses.join(', ')}{info.server_ip ? `, not this server (${info.server_ip})` : ''}. If it goes through a proxy such as Cloudflare, you can still switch: the server checks the connection itself before changing anything.</p>
            : <p className="muted-text">{lookup.domain} has no address yet. New DNS records can take a few minutes to appear; check again.</p>}
          {(lookup.points_here || lookup.addresses.length > 0) && (confirming
            ? <div className="confirm"><p>Your Grove moves to <strong>{scheme}://{lookup.domain}</strong>. The current address forwards there, and everyone signs in again at the new address.</p>
                <div className="action-row"><button className="primary" disabled={busy} onClick={() => void move()}>{busy ? 'Starting…' : `Switch to ${lookup.domain}`}</button><button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></div></div>
            : <button className={lookup.points_here ? 'primary' : 'secondary'} onClick={() => setConfirming(true)}>{lookup.points_here ? `Use ${lookup.domain}` : 'Switch anyway'}</button>)}
        </div>}
        {error && <p className="error" role="alert">{error}</p>}
      </>}
    </>}
  </section>
}

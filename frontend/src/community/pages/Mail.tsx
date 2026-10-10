import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, PenSquare, ExternalLink, Search, ArrowLeft, Inbox } from 'lucide-react'
import { api } from '../lib/community'
import { Modal } from './Workspace'

interface MailAccount { id: string; label: string }
interface MailMsg {
  id: string; account: string; sender: string; subject: string
  date: string; ts: number; read: boolean; preview: string
}
interface MailDetail { sender: string; to: string; subject: string; date: string; body: string }

function senderName(raw: string) {
  const m = raw.match(/^"?([^"<]+)"?\s*</)
  return m ? m[1].trim() : raw.split('@')[0] || raw
}

function relDate(msg: MailMsg) {
  if (!msg.ts) return msg.date.slice(0, 16)
  const d = new Date(msg.ts * 1000), diff = Date.now() - d.getTime()
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (diff < 7 * 86400000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function Mail() {
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null)
  const [activeAcct, setActiveAcct] = useState<MailAccount | null>(null)
  const [messages, setMessages] = useState<MailMsg[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<MailMsg | null>(null)
  const [detail, setDetail] = useState<MailDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null)

  useEffect(() => {
    api<MailAccount[]>('/mail/accounts').then(list => { setAccounts(list); setActiveAcct(list[0] ?? null) })
      .catch(e => { setAccounts([]); setError(e.message) })
  }, [])

  const fetchInbox = useCallback(async (acct: MailAccount) => {
    setLoading(true); setSelected(null); setDetail(null); setError('')
    try { setMessages(await api<MailMsg[]>(`/mail/inbox?account=${encodeURIComponent(acct.id === 'imap' ? '' : acct.id)}`)) }
    catch (e) { setMessages([]); setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  // Reloading the inbox for the chosen account resets the list first (fetchInbox's synchronous setState).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (activeAcct) void fetchInbox(activeAcct) }, [activeAcct, fetchInbox])

  async function openMsg(msg: MailMsg) {
    setSelected(msg); setDetail(null); setDetailError('')
    const [acct, idx] = msg.id.split('::')
    try { setDetail(await api<MailDetail>(`/mail/message/${encodeURIComponent(acct)}/${encodeURIComponent(idx)}`)) }
    catch (e) { setDetailError((e as Error).message) }
  }

  async function launch(view: 'mail' | 'compose') {
    try { await api('/mail/launch', 'POST', { view }) } catch (e) { setError((e as Error).message) }
  }

  const q = search.toLowerCase()
  const filtered = messages.filter(m => !q || m.subject.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q))
  const unread = messages.filter(m => !m.read).length
  const replyTo = (d: MailDetail) => ({ to: d.sender.match(/<([^>]+)>/)?.[1] ?? d.sender, subject: /^re:/i.test(d.subject) ? d.subject : `Re: ${d.subject}`, body: '' })

  return <div className={'connection-page mail' + (selected ? ' reading' : '')}>
    <header className="connection-header">
      <div><h1>Mail</h1>{unread > 0 && <span className="pill">{unread} unread</span>}</div>
      <div className="connection-actions">
        {accounts && accounts.length > 1 && <select aria-label="Mail account" value={activeAcct?.id ?? ''} onChange={e => setActiveAcct(accounts.find(a => a.id === e.target.value) ?? null)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select>}
        {accounts?.length === 1 && <span className="muted-text">{accounts[0].label}</span>}
        <button className="secondary" onClick={() => activeAcct && fetchInbox(activeAcct)} disabled={!activeAcct || loading}><RefreshCw size={14} /> Refresh</button>
        <button className="primary" onClick={() => setCompose({ to: '', subject: '', body: '' })}><PenSquare size={14} /> Compose</button>
        <button className="text-button" onClick={() => launch('mail')} title="Open Thunderbird on this computer"><ExternalLink size={14} /> Thunderbird</button>
      </div>
    </header>
    {error && <p className="error banner" role="alert">{error}</p>}
    {notice && <p className="notice banner" role="status">{notice}</p>}
    {accounts?.length === 0 && !error ? <div className="empty"><Inbox /><p>No mail account is set up.</p><p className="muted-text">Add IMAP settings to <code>.env</code> and restart, or sign in to Thunderbird on this computer.</p></div> :
    <div className="split">
      <section className="split-list" aria-label="Messages">
        <label className="search-box"><Search size={15} aria-hidden="true" /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mail" aria-label="Search mail" /></label>
        <div className="scroll">
          {loading && <div className="empty small">Loading...</div>}
          {!loading && filtered.length === 0 && <div className="empty small">No messages</div>}
          {filtered.map(msg => <button key={msg.id} className={'mail-row' + (selected?.id === msg.id ? ' active' : '') + (msg.read ? '' : ' unread')} onClick={() => openMsg(msg)}>
            <span className="mail-top"><b>{senderName(msg.sender)}</b><time>{relDate(msg)}</time></span>
            <span className="mail-subject">{msg.subject || '(no subject)'}</span>
            {msg.preview && <span className="mail-preview">{msg.preview}</span>}
          </button>)}
        </div>
      </section>
      <section className="split-detail" aria-label="Message">
        {!selected ? <div className="empty"><Inbox /><p>Select a message to read</p></div> : <>
          <div className="mail-head">
            <button className="icon-button back-button" aria-label="Back to messages" onClick={() => setSelected(null)}><ArrowLeft size={18} /></button>
            <h2>{selected.subject || '(no subject)'}</h2>
            <dl><dt>From</dt><dd>{detail?.sender ?? selected.sender}</dd>{detail?.to && <><dt>To</dt><dd>{detail.to}</dd></>}<dt>Date</dt><dd>{selected.date}</dd></dl>
            {detail && <div className="action-row"><button className="secondary" onClick={() => setCompose(replyTo(detail))}>Reply</button></div>}
          </div>
          <div className="scroll mail-body">
            {detailError ? <p className="error">{detailError}</p> : !detail ? <p className="muted-text">Loading...</p> : <pre>{detail.body || '(empty)'}</pre>}
          </div>
        </>}
      </section>
    </div>}
    {compose && <Modal title="New message" onClose={() => setCompose(null)}><ComposeForm initial={compose} onSent={() => { setCompose(null); setNotice('Message sent.') }} onThunderbird={() => { setCompose(null); void launch('compose') }} /></Modal>}
  </div>
}

function ComposeForm({ initial, onSent, onThunderbird }: { initial: { to: string; subject: string; body: string }; onSent: () => void; onThunderbird: () => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <form onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { await api('/mail/send', 'POST', Object.fromEntries(new FormData(e.currentTarget))); onSent() }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <label>To<input type="email" name="to" defaultValue={initial.to} required maxLength={254} autoFocus={!initial.to} /></label>
    <label>Subject<input name="subject" defaultValue={initial.subject} maxLength={500} /></label>
    <label>Message<textarea name="body" rows={10} required maxLength={200000} autoFocus={Boolean(initial.to)} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="action-row"><button className="primary" disabled={busy}>{busy ? 'Sending' : 'Send'}</button><button type="button" className="text-button" onClick={onThunderbird}>Write in Thunderbird instead</button></div>
  </form>
}

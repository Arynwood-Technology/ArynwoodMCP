import { useState } from 'react'
import { api } from '../lib/community'
import { Modal } from '../pages/Workspace'
import './wish-lamp.css'

export function GenieLamp({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 13h10a5 4.2 0 0 1-10 0z" />
    <path d="M9.5 13a2.5 2.3 0 0 1 5 0M12 10.7V9.6" />
    <path d="M7.6 15.6C5.2 15.4 3.7 13.6 2 12.1c2 0 3.6.3 5 .9" />
    <path d="M16.9 12.1c1.7-1.4 4.1-1.1 4.1.6 0 1.6-1.9 2.6-4.3 2.6" />
    <path d="M10.2 17.1l-.7 2.4h5l-.7-2.4" />
    <path d="M4.5 3.4c.3 1.4.8 1.9 2.2 2.2-1.4.3-1.9.8-2.2 2.2-.3-1.4-.8-1.9-2.2-2.2 1.4-.3 1.9-.8 2.2-2.2z" strokeWidth="1.3" />
  </svg>
}

/** Small, and always in the bottom-right corner: anyone can wish for something in this Grove. */
export function WishLamp({ page, spaceId }: { page: string; spaceId?: string }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [sent, setSent] = useState(false)
  async function send(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('/wishes', 'POST', { body: text, page, space_id: spaceId ?? '' }); setSent(true); setText('') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <>
    <button className="wish-lamp" aria-label="Make a wish" title="Make a wish: ask for something in this Grove" onClick={() => { setSent(false); setError(''); setOpen(true) }}><GenieLamp /></button>
    {open && <Modal title="Make a wish" onClose={() => { if (!busy) setOpen(false) }}>
      {sent ? <>
        <p role="status">Your wish is on its way. Thank you!</p>
        <div className="action-row"><button className="primary" onClick={() => setOpen(false)}>Done</button><button className="secondary" onClick={() => setSent(false)}>Make another wish</button></div>
      </> : <form onSubmit={send}>
        <p className="muted-text">Something you want in this Grove? A tool, a change, a fix. Describe it, and it goes to the people who build and run it.</p>
        {/* Kept while the page is open, so closing by mistake loses nothing. */}
        <label>Your wish<textarea value={text} onChange={e => setText(e.target.value)} required maxLength={4000} rows={5} placeholder="I wish we could…" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="action-row"><button className="primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send wish'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
      </form>}
    </Modal>}
  </>
}

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, FileText, ImagePlus, MessageCirclePlus, Paperclip, Send, Undo2, X } from 'lucide-react'
import { stamp, type User } from '../lib/community'
import { groveUrl, saveLink } from '../lib/grove'
import { bytes } from '../lib/files'
import { useLiveRefresh } from '../lib/live'
import { FILE_MAX, fileUrl, messagesApi, photoUrl, shrinkPhoto, uploadAttachment, uploadPhoto, type Attachment, type Conversation, type Person, type Photo, type Thread } from '../lib/messages'
import { Modal } from './Workspace'
import { NotifyMessages } from '../components/NotifySettings'
import './messages.css'

/** A photo or file waiting to go with the next message. */
interface Pending { key: string; kind: 'photo' | 'file'; name: string; size: number; preview?: string; photo?: Photo; file?: Attachment; sent?: number; error?: string }
const PER_MESSAGE = 6
// Photos are made smaller and lose their camera details on the way; anything else goes as a file, as it is.
const isPhoto = (file: File) => /^image\/(jpeg|png|webp|heic|heif|avif|bmp)$/.test(file.type)

/** Private conversations between two members, with photos and files. Only the two people in one can read it. */
export function Messages({ user }: { user: User }) {
  const [list, setList] = useState<Conversation[] | null>(null), [thread, setThread] = useState<Thread | null>(null)
  const [openId, setOpenId] = useState(''), [people, setPeople] = useState<Person[] | null>(null)
  const [draft, setDraft] = useState(''), [pending, setPending] = useState<Pending[]>([]), [sending, setSending] = useState(false)
  const [error, setError] = useState(''), [viewing, setViewing] = useState<Photo | null>(null), [dropping, setDropping] = useState(false)
  const end = useRef<HTMLDivElement>(null), picker = useRef<HTMLInputElement>(null), filePicker = useRef<HTMLInputElement>(null), seen = useRef('')
  const [tick, setTick] = useState(0), reload = () => setTick(n => n + 1)
  useEffect(() => {
    let active = true
    const fail = (e: Error) => { if (active) setError(e.message) }
    messagesApi.conversations().then(value => { if (active) setList(value) }).catch(fail)
    if (openId) messagesApi.thread(openId).then(current => {
      if (!active) return
      setThread(current)
      if (current.unread) void messagesApi.read(openId).catch(() => {})
    }).catch(fail)
    return () => { active = false }
  }, [openId, tick])
  useLiveRefresh(groveUrl('/messages/events'), reload, 20000)
  // New messages bring the conversation's end into view.
  useEffect(() => {
    const last = thread?.messages.at(-1)?.id ?? ''
    if (thread && last !== seen.current) { seen.current = last; end.current?.scrollIntoView?.({ block: 'end' }) }
  }, [thread])

  function open(id: string) { setThread(null); setOpenId(id); setDraft(''); setPending([]); setError('') }
  async function startWith(person: Person) {
    setPeople(null)
    try { open((await messagesApi.start(person.id)).id) }
    catch (e) { setError((e as Error).message) }
  }
  async function choose() {
    try { setPeople(await messagesApi.people()) } catch (e) { setError((e as Error).message) }
  }
  const update = (key: string, change: Partial<Pending>) => setPending(list => list.map(p => p.key === key ? { ...p, ...change } : p))
  function addPhotos(files: File[]) {
    const room = PER_MESSAGE - pending.filter(p => p.kind === 'photo').length
    if (files.length > room) setError(`Up to ${PER_MESSAGE} photos go in one message.`)
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = `${file.name}:${Math.random()}`, preview = URL.createObjectURL(file)
      setPending(list => [...list, { key, kind: 'photo', name: file.name, size: file.size, preview }])
      void shrinkPhoto(file).then(uploadPhoto)
        .then(photo => update(key, { photo }))
        .catch(e => update(key, { error: (e as Error).message }))
    }
  }
  function addFiles(files: File[]) {
    const room = PER_MESSAGE - pending.filter(p => p.kind === 'file').length
    if (files.length > room) setError(`Up to ${PER_MESSAGE} files go in one message.`)
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = `${file.name}:${Math.random()}`
      if (file.size > FILE_MAX) { setPending(list => [...list, { key, kind: 'file', name: file.name, size: file.size, error: `Over ${bytes(FILE_MAX)}: put it in a space’s Files.` }]); continue }
      setPending(list => [...list, { key, kind: 'file', name: file.name, size: file.size, sent: 0 }])
      void uploadAttachment(file, sent => update(key, { sent }))
        .then(attached => update(key, { file: attached }))
        .catch(e => update(key, { error: (e as Error).message }))
    }
  }
  /** Dropped or pasted: photos go as photos, everything else as files. */
  const add = (files: File[]) => { addPhotos(files.filter(isPhoto)); addFiles(files.filter(f => !isPhoto(f))) }
  function drop(key: string) {
    setPending(list => { const gone = list.find(p => p.key === key); if (gone?.preview) URL.revokeObjectURL(gone.preview); return list.filter(p => p.key !== key) })
  }
  // Sendable once each photo and file is ready (or has failed and will be left out) and there's something to send.
  const ready = !pending.some(p => !p.photo && !p.file && !p.error) && (!!draft.trim() || pending.some(p => p.photo || p.file))
  const photosWaiting = pending.filter(p => p.kind === 'photo'), filesWaiting = pending.filter(p => p.kind === 'file')
  async function send() {
    if (!thread || sending || !ready) return
    setSending(true); setError('')
    try {
      await messagesApi.send(thread.id, draft, pending.filter(p => p.photo).map(p => p.photo!.id), pending.filter(p => p.file).map(p => p.file!.id))
      pending.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview) })
      setDraft(''); setPending([]); reload()
    } catch (e) { setError((e as Error).message) } finally { setSending(false) }
  }
  async function takeBack(id: string) {
    if (!window.confirm('Take this message back? It disappears for both of you.')) return
    try { await messagesApi.takeBack(id); reload() } catch (e) { setError((e as Error).message) }
  }

  return <div className={'workspace messages-page' + (openId ? ' reading' : '')}>
    <div className="page-heading"><div><span className="eyebrow">Just between you</span><h1>Messages</h1>
      <p>Private conversations with anyone you share a space with, with photos and files. Only the two of you can read them.</p></div>
      <div className="action-row"><NotifyMessages /><button className="primary" onClick={() => void choose()}><MessageCirclePlus size={16} /> New message</button></div></div>
    {error && <p className="error" role="alert">{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></p>}
    <div className="messages-layout">
      <nav className="panel conversation-list" aria-label="Conversations">
        {list?.map(c => <button key={c.id} className={'conversation' + (c.id === openId ? ' open' : '')} aria-current={c.id === openId ? 'true' : undefined} onClick={() => open(c.id)}>
          <span className="avatar small" aria-hidden="true">{c.with.name.charAt(0).toUpperCase()}</span>
          <span className="who"><strong>{c.with.name}</strong><small>{c.last ? (c.last_from_me ? 'You: ' : '') + c.last : 'No messages yet'}</small></span>
          {c.unread > 0 && <span className="nav-badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
        </button>)}
        {list && !list.length && <p className="muted-text">No conversations yet. Choose <strong>New message</strong> to write to someone.</p>}
      </nav>
      <section className={'panel conversation-view' + (dropping ? ' dropping' : '')} aria-label="Conversation"
        onDragOver={e => { if (thread?.can_write && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false) }}
        onDrop={e => { e.preventDefault(); setDropping(false); if (thread?.can_write) add(Array.from(e.dataTransfer.files)) }}>
        {!openId ? <p className="muted-text">Choose a conversation, or start a new one.</p> : !thread ? <p>Opening…</p> : <>
          <header className="conversation-header">
            <button className="icon-button back" aria-label="Back to conversations" onClick={() => { setOpenId(''); setThread(null) }}><ArrowLeft size={18} /></button>
            <span className="avatar small" aria-hidden="true">{thread.with.name.charAt(0).toUpperCase()}</span><h2>{thread.with.name}</h2>
          </header>
          <ol className="message-stream">
            {thread.messages.map(m => { const mine = m.sender_id === user.id; return <li key={m.id} className={'message' + (mine ? ' mine' : '')}>
              <div className={'bubble' + (!m.deleted && !m.body && m.photos.length && !m.files.length ? ' just-photos' : '')}>
                {m.deleted ? <em className="muted-text">{mine ? 'You took this message back.' : 'This message was taken back.'}</em> : <>
                  {m.photos.length > 0 && <div className={'message-photos count-' + Math.min(m.photos.length, 4)}>{m.photos.map(p =>
                    <button key={p.id} className="message-photo" onClick={() => setViewing(p)} aria-label="Open photo"><img src={photoUrl(p.id)} alt="" width={p.width} height={p.height} loading="lazy" /></button>)}</div>}
                  {m.files.length > 0 && <ul className="message-files">{m.files.map(f => <li key={f.id}><a href={fileUrl(f.id)} download={f.name} title={`Download ${f.name}`} onClick={saveLink(f.name, e => setError(e.message))}>
                    <FileText size={20} aria-hidden="true" /><span><strong>{f.name}</strong><small>{bytes(f.size)}</small></span><Download size={15} aria-hidden="true" /></a></li>)}</ul>}
                  {m.body && <p>{m.body}</p>}</>}
              </div>
              <small className="message-meta">{stamp(m.created)}{mine && !m.deleted && <button className="text-button" aria-label="Take this message back" title="Take back" onClick={() => void takeBack(m.id)}><Undo2 size={13} /></button>}</small>
            </li> })}
            {!thread.messages.length && <li className="muted-text">Say hello to {thread.with.name}.</li>}
          </ol>
          <div ref={end} />
          {thread.can_write ? <form className="composer" onSubmit={e => { e.preventDefault(); void send() }}>
            {filesWaiting.length > 0 && <ul className="pending-files" aria-label="Files to send">{filesWaiting.map(p => <li key={p.key} className={p.error ? 'failed' : p.file ? '' : 'working'}>
              <FileText size={18} aria-hidden="true" /><span className="who"><strong>{p.name}</strong>
                <small>{p.error ?? (p.file ? bytes(p.size) : `Sending… ${p.size ? Math.round((p.sent ?? 0) / p.size * 100) : 0}%`)}</small></span>
              <button type="button" className="icon-button" aria-label={`Remove ${p.name}`} onClick={() => drop(p.key)}><X size={14} /></button></li>)}</ul>}
            {photosWaiting.length > 0 && <ul className="pending-photos" aria-label="Photos to send">{photosWaiting.map(p => <li key={p.key} className={p.error ? 'failed' : p.photo ? '' : 'working'}>
              <img src={p.preview} alt="" />{!p.photo && !p.error && <span className="pending-state">Preparing…</span>}{p.error && <span className="pending-state" title={p.error}>Couldn’t send</span>}
              <button type="button" className="icon-button" aria-label="Remove this photo" onClick={() => drop(p.key)}><X size={14} /></button></li>)}</ul>}
            <div className="composer-row">
              <button type="button" className="icon-button" aria-label="Add photos" title="Add photos" disabled={photosWaiting.length >= PER_MESSAGE} onClick={() => picker.current?.click()}><ImagePlus size={20} /></button>
              <input ref={picker} type="file" accept="image/*" multiple hidden aria-label="Choose photos" onChange={e => { addPhotos(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              <button type="button" className="icon-button" aria-label="Attach files" title={`Attach files, up to ${bytes(FILE_MAX)} each`} disabled={filesWaiting.length >= PER_MESSAGE} onClick={() => filePicker.current?.click()}><Paperclip size={20} /></button>
              <input ref={filePicker} type="file" multiple hidden aria-label="Choose files" onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              <textarea aria-label={`Message ${thread.with.name}`} placeholder={`Message ${thread.with.name}`} rows={1} maxLength={4000} value={draft}
                onChange={e => setDraft(e.target.value)}
                onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); add(files) } }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
              <button className="primary send" aria-label="Send" disabled={!ready || sending}><Send size={17} /></button>
            </div>
          </form> : <p className="muted-text">You no longer share a space with {thread.with.name}, so this conversation is read-only.</p>}
        </>}
      </section>
    </div>
    {people && <Modal title="New message" onClose={() => setPeople(null)}>
      {people.length ? <ul className="member-list">{people.map(p => <li key={p.id}><span className="avatar small" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
        <span className="who"><strong>{p.name}</strong></span><button className="secondary push" onClick={() => void startWith(p)}>Write</button></li>)}</ul>
        : <p>When someone joins a space you're in, you can write to them here.</p>}
    </Modal>}
    {viewing && <Modal title="Photo" onClose={() => setViewing(null)}>
      <img className="message-photo-full" src={photoUrl(viewing.id)} alt="" />
      <a className="secondary button-link" href={photoUrl(viewing.id)} download onClick={saveLink(`photo-${viewing.id.slice(0, 8)}.jpg`, e => setError(e.message))}>Download</a>
    </Modal>}
  </div>
}

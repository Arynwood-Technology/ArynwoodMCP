import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Code, ExternalLink, MessageSquarePlus, Radio } from 'lucide-react'
import { stamp, type User } from '../lib/community'
import { GroveContext, groveUrl, openOutside } from '../lib/grove'
import { useLiveRefresh } from '../lib/live'
import { pinsFor, siteApi, type Device, type SiteNote, type SiteReview as Review, type SiteTarget, type Spot } from '../lib/site'
import { PreviewFrame, type PreviewHandle } from '../components/PreviewFrame'
import { NoteComposer, NotesPanel, PreviewBar } from '../components/SiteNotes'
import './site.css'

const RENEW_MS = 50 * 60 * 1000 // preview addresses last an hour

/** A website before it's published, for everyone in the Grove: look at it at any size, and point at
 *  what should change. It updates by itself whenever a webmaster saves. */
export function SiteReview({ user, target, onBack, onEdit }: { user: User; target: SiteTarget; onBack: () => void; onEdit?: () => void }) {
  const grove = useContext(GroveContext)
  const [review, setReview] = useState<Review | null>(null), [url, setUrl] = useState(''), [error, setError] = useState('')
  const [device, setDevice] = useState<Device>('computer'), [here, setHere] = useState('/'), [picking, setPicking] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(null), [selected, setSelected] = useState(''), [updated, setUpdated] = useState('')
  const frame = useRef<PreviewHandle>(null), changed = useRef('')
  const load = useRef(async () => {})
  useEffect(() => {
    let active = true
    load.current = async () => {
      try {
        const next = await siteApi.review(target.space, target.folder)
        if (!active) return
        // Saved changes: the preview reloads where it was.
        if (changed.current && next.changed !== changed.current) { frame.current?.reload(); setUpdated(new Date().toISOString()) }
        changed.current = next.changed; setReview(next); setError('')
      } catch (e) { if (active) setError((e as Error).message) }
    }
    const renew = () => siteApi.preview(target.space, target.folder).then(v => { if (active) setUrl(v.url) }).catch(e => { if (active) setError(e.message) })
    void load.current(); void renew()
    const timer = setInterval(renew, RENEW_MS)
    return () => { active = false; clearInterval(timer) }
  }, [target.space, target.folder])
  useLiveRefresh(groveUrl('/messages/events'), () => void load.current(), 30000, 'website')
  useEffect(() => {
    if (!picking) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPicking(false) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [picking])

  const notes = useMemo(() => review?.notes ?? [], [review])
  const pins = useMemo(() => pinsFor(notes, here, selected), [notes, here, selected])
  const show = (note: SiteNote) => { setSelected(note.id); frame.current?.show(note.page, note.id) }
  const noteHere = () => { setPicking(false); setSpot({ page: here, selector: '', quote: '', tag: '', x: 0, y: 0 }) }
  return <div className="workspace site-review">
    <div className="page-heading"><div>
      <button className="text-button back" onClick={onBack}><ArrowLeft size={15} /> Website</button>
      <span className="eyebrow">Preview{review ? ` · ${review.space_name}` : ''}</span><h1>{review?.name ?? target.folder.replace(/^Website\//, '')}</h1>
      <p>What this site will look like once it’s published. Point at anything that should change, and the webmasters see your note straight away.</p>
    </div>{onEdit && <button className="secondary" onClick={onEdit}><Code size={15} /> Open in the site editor</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="review-layout">
      <section className="review-preview" aria-label="Preview">
        <PreviewBar pages={review?.pages ?? []} here={here} device={device} onDevice={setDevice} onPage={address => frame.current?.show(address)}>
          <button className={picking ? 'secondary' : 'primary'} aria-pressed={picking} onClick={() => { setSpot(null); setPicking(p => !p) }}><MessageSquarePlus size={15} /> {picking ? 'Cancel' : 'Add a note'}</button>
          {url && <a className="icon-button" href={grove.url + url.replace(/\/$/, '') + here} target="_blank" rel="noopener noreferrer" onClick={openOutside} title="Open in a new tab" aria-label="Open in a new tab"><ExternalLink size={16} /></a>}
        </PreviewBar>
        {picking ? <p className="pick-hint" role="status">Click the part of the page your note is about. <button className="text-button" onClick={noteHere}>Or write about the whole page</button></p>
          : <p className="live-hint"><Radio size={14} aria-hidden="true" /> Live: this updates by itself when the site changes.{updated && ` Updated ${stamp(updated)}.`}</p>}
        {url ? <PreviewFrame ref={frame} url={url} device={device} title={`Preview of ${review?.name ?? 'the website'}`} pins={pins} picking={picking}
          onPage={address => setHere(address)} onPicked={picked => { setPicking(false); setSpot(picked) }} onPickEnd={() => setPicking(false)} onPin={setSelected} />
          : <p className="preview-stage">Opening the preview…</p>}
      </section>
      <NotesPanel notes={notes} user={user} here={here} selected={selected} onShow={show} onChanged={() => void load.current()}>
        {spot && <NoteComposer key={spot.page + spot.selector + spot.x} spot={spot} device={device} target={target} onCancel={() => setSpot(null)}
          onSaved={note => { setSpot(null); setSelected(note.id); void load.current().then(() => frame.current?.show(note.page, note.id)) }} />}
      </NotesPanel>
    </div>
  </div>
}

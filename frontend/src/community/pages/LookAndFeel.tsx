import { useEffect, useRef, useState } from 'react'
import { ImageUp, Palette, RotateCcw, Save, Trash2, Wand2 } from 'lucide-react'
import { api } from '../lib/community'
import { groveAddress, groveTheme, groveUrl } from '../lib/grove'
import { contentUrl } from '../lib/files'
import { LOOK_CHANGED, themeStyle } from '../lib/brand'
import { Modal } from './Workspace'
import type { SiteState } from './Webmaster'
import './look.css'

export interface Look {
  name: string; tagline: string; background: string; text: string; accent: string; login_background: string
  font_heading: 'clean' | 'rounded' | 'classic' | 'bold'; font_body: 'clean' | 'rounded' | 'classic'
  corners: 'round' | 'soft' | 'square'; logo_shape: 'original' | 'circle'
  site_url: string; site_label: string; shop_url: string; shop_label: string
}
export interface LookState { look: Look; custom: boolean; theme: Record<string, string>; logo_url: string; picture_url: string; sizes: { logo: number; picture: number } }
interface Found { background?: string; text?: string; accent?: string; login_background?: string; font_heading?: Look['font_heading']; font_body?: Look['font_body']
  logo: { file_id: string; name: string; space_id: string } | null; picture: { file_id: string; name: string; space_id: string } | null }
type Kind = 'logo' | 'picture'
const FALLBACK = '#0f1314'
const fonts: Record<Look['font_heading'], string> = { clean: 'Clean (Inter)', rounded: 'Rounded and friendly', classic: 'Classic serif', bold: 'Bold display (like Impact)' }
const words: Record<Kind, string> = { logo: 'logo', picture: 'login picture' }

/** Owners make the Grove look like their organisation: name and words, colours, type, corners and pictures. */
export function LookAndFeel() {
  const [state, setState] = useState<LookState | null>(null), [draft, setDraft] = useState<Look | null>(null)
  const [preview, setPreview] = useState<Record<string, string>>({}), [sites, setSites] = useState<SiteState['sites']>([])
  const [found, setFound] = useState<Found | null>(null), [resetting, setResetting] = useState(false)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  const flash = (text: string) => { setMessage(text); setError('') }
  const fail = (e: unknown) => { setError((e as Error).message); setMessage('') }
  // The pictures it names are reached through Arynwood, as everything else on the Grove is.
  const settle = (raw: LookState) => { const value = { ...raw, logo_url: groveAddress(raw.logo_url), picture_url: groveAddress(raw.picture_url), theme: groveTheme(raw.theme) }; setState(value); setDraft({ ...value.look, background: value.look.background || FALLBACK }) }
  useEffect(() => {
    api<LookState>('/brand/look').then(settle).catch(fail)
    api<SiteState>('/webmaster/site').then(value => setSites(value.sites.filter(s => s.member))).catch(() => {})
  }, [])
  // The preview follows each change, a moment after it.
  useEffect(() => {
    if (!draft) return
    let active = true
    const timer = setTimeout(() => api<{ theme: Record<string, string> }>('/brand/look/preview', 'POST', draft)
      .then(value => { if (active) { setPreview(groveTheme(value.theme)); setError('') } }).catch(e => { if (active) setError(e.message) }), 250)
    return () => { active = false; clearTimeout(timer) }
  }, [draft, state?.picture_url])
  if (!state || !draft) return <div className="workspace"><p>{error || 'Opening Look & feel…'}</p></div>
  const change = (values: Partial<Look>) => { setDraft(d => d && { ...d, ...values }); setMessage('') }
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...state.look, background: state.look.background || FALLBACK })
  const announce = (value: LookState, text: string) => { settle(value); window.dispatchEvent(new Event(LOOK_CHANGED)); flash(text) }
  async function act(name: string, work: () => Promise<void>) { setBusy(name); try { await work() } catch (e) { fail(e) } finally { setBusy('') } }
  const save = () => act('save', async () => announce(await api<LookState>('/brand/look', 'PUT', draft), 'Saved. Everyone sees the new look the next time a page opens.'))
  const reset = () => { setResetting(false); void act('reset', async () => announce(await api<LookState>('/brand/look', 'DELETE'), 'This Grove looks as its host set it up again.')) }
  const sendImage = (kind: Kind, file: File) => act(kind, async () => {
    if (file.size > state.sizes[kind]) throw new Error(`Use a picture of up to ${state.sizes[kind] / 1024} KB.`)
    const response = await fetch(groveUrl(`/brand/look/${kind}`), { method: 'PUT', body: file, headers: { 'X-Community-Request': '1', 'Content-Type': file.type || 'application/octet-stream' } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The picture could not be used.')
    announce(data as LookState, `The new ${words[kind]} is in place.`)
  })
  const removeImage = (kind: Kind) => act(kind, async () => announce(await api<LookState>(`/brand/look/${kind}`, 'DELETE'), `The ${words[kind]} is gone.`))
  const takeFile = (kind: Kind, file: { space_id: string; file_id: string }) => act(kind, async () => announce(await api<LookState>(`/brand/look/${kind}/from-file`, 'POST', { space_id: file.space_id, file_id: file.file_id }), `Your website’s ${words[kind] === 'logo' ? 'logo' : 'share picture'} is now the ${words[kind]}.`))
  const fromSite = (key: string) => act('site', async () => {
    const site = sites.find(s => s.space_id + '\n' + s.folder === key)
    if (!site) return
    const result = await api<Found>('/brand/look/from-site', 'POST', { space_id: site.space_id, folder: site.folder })
    change(Object.fromEntries(Object.entries(result).filter(([key, value]) => key !== 'logo' && key !== 'picture' && value)) as Partial<Look>); setFound(result)
    flash(`Filled in from ${site.name}. Check the preview, change anything you like, then save.`)
  })
  const adjusted = (chosen: string, shown?: string) => chosen && shown && chosen.toLowerCase() !== shown.toLowerCase() ? shown : ''

  return <div className="workspace look-and-feel">
    <div className="page-heading"><div><span className="eyebrow">This Grove</span><h1>Look &amp; feel</h1>
      <p>Make this Grove look like your organisation: its name, colours, type and pictures, on every page and the login page.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="look-layout">
      <div className="look-form">
        {sites.length > 0 && <section className="panel">
          <h2><Wand2 size={18} aria-hidden="true" /> Start from your website</h2>
          <p>The Grove reads a website in your Files and suggests its colours, type, logo and share picture.</p>
          <div className="look-row"><select aria-label="Website" defaultValue="" onChange={e => { if (e.target.value) void fromSite(e.target.value) }} disabled={busy === 'site'}>
            <option value="" disabled>Choose a website…</option>
            {sites.map(s => <option key={s.space_id + s.folder} value={s.space_id + '\n' + s.folder}>{s.name} ({s.space_name})</option>)}</select></div>
          {found && (found.logo || found.picture) && <div className="found-pictures">
            {found.logo && <figure><img src={contentUrl(found.logo.space_id, found.logo.file_id, '?inline=1')} alt="" /><figcaption>{found.logo.name}</figcaption>
              <button className="secondary" disabled={!!busy} onClick={() => found.logo && void takeFile('logo', found.logo)}>Use as the logo</button></figure>}
            {found.picture && <figure><img src={contentUrl(found.picture.space_id, found.picture.file_id, '?inline=1')} alt="" /><figcaption>{found.picture.name}</figcaption>
              <button className="secondary" disabled={!!busy} onClick={() => found.picture && void takeFile('picture', found.picture)}>Use on the login page</button></figure>}
          </div>}
        </section>}

        <section className="panel">
          <h2>Name and words</h2>
          <label>Name<input value={draft.name} maxLength={80} placeholder="Arynwood Grove" onChange={e => change({ name: e.target.value })} /></label>
          <label>Tagline<input value={draft.tagline} maxLength={160} onChange={e => change({ tagline: e.target.value })} /></label>
          <div className="look-pair">
            <label>Website link<input value={draft.site_url} maxLength={2048} placeholder="https://" onChange={e => change({ site_url: e.target.value })} /></label>
            <label>Its label<input value={draft.site_label} maxLength={40} placeholder="Website" onChange={e => change({ site_label: e.target.value })} /></label>
          </div>
          <div className="look-pair">
            <label>Shop link<input value={draft.shop_url} maxLength={2048} placeholder="https://" onChange={e => change({ shop_url: e.target.value })} /></label>
            <label>Its label<input value={draft.shop_label} maxLength={40} placeholder="Shop" onChange={e => change({ shop_label: e.target.value })} /></label>
          </div>
        </section>

        <section className="panel">
          <h2><Palette size={18} aria-hidden="true" /> Colours</h2>
          <p>Light or dark, any colours work: the Grove adjusts them only as far as it must for text, buttons and borders to stay easy to read.</p>
          <Colour label="Background" hint="Pages and panels" value={draft.background} onChange={background => change({ background })} shown={adjusted(draft.background, preview['--bg'])} />
          <Colour label="Text" value={draft.text} automatic={preview['--text']} onChange={text => change({ text })} shown={adjusted(draft.text, preview['--text'])} />
          <Colour label="Accent" hint="Buttons, links and highlights" value={draft.accent} automatic={preview['--accent']} onChange={accent => change({ accent })} shown={adjusted(draft.accent, preview['--accent'])} />
          <Colour label="Login page" hint="The side with your name and logo" value={draft.login_background} automatic={preview['--login-base']} onChange={login_background => change({ login_background })} shown={adjusted(draft.login_background, preview['--login-base'])} />
        </section>

        <section className="panel">
          <h2>Type and shape</h2>
          <div className="look-pair">
            <label>Headings<select value={draft.font_heading} onChange={e => change({ font_heading: e.target.value as Look['font_heading'] })}>
              {Object.entries(fonts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Body text<select value={draft.font_body} onChange={e => change({ font_body: e.target.value as Look['font_body'] })}>
              {(['clean', 'rounded', 'classic'] as const).map(value => <option key={value} value={value}>{fonts[value]}</option>)}</select></label>
          </div>
          <div className="look-pair">
            <label>Corners<select value={draft.corners} onChange={e => change({ corners: e.target.value as Look['corners'] })}>
              <option value="round">Round</option><option value="soft">Soft</option><option value="square">Square</option></select></label>
            <label>Logo<select value={draft.logo_shape} onChange={e => change({ logo_shape: e.target.value as Look['logo_shape'] })}>
              <option value="original">As it is</option><option value="circle">In a circle</option></select></label>
          </div>
        </section>

        <section className="panel">
          <h2><ImageUp size={18} aria-hidden="true" /> Pictures</h2>
          <p>PNG, JPEG or WebP. They change straight away, without saving.</p>
          {(['logo', 'picture'] as const).map(kind => <div className="look-picture" key={kind}>
            <span className="look-thumb">{(kind === 'logo' ? state.logo_url : state.picture_url) ? <img src={kind === 'logo' ? state.logo_url : state.picture_url} alt={`Current ${words[kind]}`} /> : <small>None</small>}</span>
            <span className="who"><strong>{kind === 'logo' ? 'Logo' : 'Login page picture'}</strong><small>Up to {state.sizes[kind] / 1024} KB{kind === 'picture' ? ', shown behind the login page’s words' : ''}</small></span>
            <label className="secondary button-link"><ImageUp size={15} /> Upload<input type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={`Upload a ${words[kind]}`}
              onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void sendImage(kind, file) }} /></label>
            {(kind === 'logo' ? state.logo_url : state.picture_url) && <button className="icon-button" aria-label={`Remove the ${words[kind]}`} title="Remove" disabled={!!busy} onClick={() => void removeImage(kind)}><Trash2 size={16} /></button>}
          </div>)}
        </section>

        <div className="action-row look-actions">
          <button className="primary" disabled={!dirty || !!busy} onClick={() => void save()}><Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button className="secondary" disabled={!dirty || !!busy} onClick={() => { settle(state); setFound(null); setMessage('') }}>Undo changes</button>
          {state.custom && <button className="secondary" disabled={!!busy} onClick={() => setResetting(true)}><RotateCcw size={15} /> Back to the host’s look</button>}
        </div>
      </div>
      <aside className="look-preview" aria-label="Preview">
        <h2>Preview</h2>
        <Scaled label="Login page"><LoginMock draft={draft} logo={state.logo_url} picture={state.picture_url} theme={preview} /></Scaled>
        <Scaled label="Members’ pages"><MembersMock draft={draft} logo={state.logo_url} theme={preview} /></Scaled>
      </aside>
    </div>
    {resetting && <Modal title="Go back to the host’s look?" onClose={() => setResetting(false)}>
      <p>The name, colours, type and pictures chosen here are forgotten, and the Grove looks as its host set it up.</p>
      <div className="action-row"><button className="danger-button" onClick={reset}>Go back</button><button className="secondary" onClick={() => setResetting(false)}>Cancel</button></div>
    </Modal>}
  </div>
}

/** A colour with its picker and its code; some can be left for the Grove to choose. */
function Colour({ label, hint, value, automatic, shown, onChange }: { label: string; hint?: string; value: string; automatic?: string; shown?: string; onChange: (value: string) => void }) {
  // A code being typed shows as typed until it's a whole colour.
  const [typing, setTyping] = useState<string | null>(null)
  const auto = automatic !== undefined && !value
  return <div className="look-colour">
    <span className="who"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    <input type="color" aria-label={`${label} colour`} value={value || automatic || FALLBACK} onChange={e => onChange(e.target.value)} />
    <input className="hex" aria-label={`${label} code`} value={typing ?? (auto ? '' : value)} placeholder={auto ? 'Automatic' : '#rrggbb'} maxLength={7}
      onChange={e => { const code = e.target.value; if (/^#[0-9a-f]{6}$/i.test(code)) { setTyping(null); onChange(code.toLowerCase()) } else setTyping(code) }} onBlur={() => setTyping(null)} />
    {automatic !== undefined && <label className="look-auto"><input type="checkbox" checked={auto} onChange={e => onChange(e.target.checked ? '' : automatic || FALLBACK)} /> Automatic</label>}
    {shown && <small className="look-adjusted">Shown as {shown} so it stays readable.</small>}
  </div>
}

/** A page drawn at full size and shrunk to fit beside the form. */
function Scaled({ label, children }: { label: string; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null), [zoom, setZoom] = useState(.5)
  useEffect(() => {
    if (!frame.current || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(([entry]) => setZoom(Math.min(1, entry.contentRect.width / 1000)))
    watch.observe(frame.current)
    return () => watch.disconnect()
  }, [])
  return <figure className="look-frame" ref={frame}><figcaption>{label}</figcaption><div className="look-canvas" style={{ zoom }}>{children}</div></figure>
}

function LoginMock({ draft, logo, picture, theme }: { draft: Look; logo: string; picture: string; theme: Record<string, string> }) {
  const name = draft.name || 'Arynwood Grove'
  return <div className="welcome look-mock" style={themeStyle(theme)} aria-hidden="true">
    <section className={'welcome-story' + (picture ? ' with-picture' : '')}><div className="brand"><span>{name}</span></div>
      <div>{logo && <img className="brand-logo welcome-logo" src={logo} alt="" />}<span className="eyebrow">{draft.tagline || 'A place for your people'}</span><h1>{name}</h1>
        {draft.site_url && <div className="brand-links"><a>{draft.site_label || 'Website'}</a></div>}
        <div className="welcome-features"><span>Conversations</span><span>Shared plans</span><span>Everyday life</span></div></div>
      <small className="brand-credit"><a>Runs on Arynwood Grove</a></small>
    </section>
    <section className="welcome-form"><span className="badge">{name}</span><h2>Welcome back</h2><p className="muted-text">A place to stay in touch with your people.</p>
      <label>Email<input readOnly tabIndex={-1} value="you@example.com" /></label><label>Password<input readOnly tabIndex={-1} type="password" value="password-here" /></label>
      <button className="primary" tabIndex={-1}>Sign in</button></section>
  </div>
}

function MembersMock({ draft, logo, theme }: { draft: Look; logo: string; theme: Record<string, string> }) {
  const name = draft.name || 'Arynwood Grove'
  return <div className="look-mock look-members" style={themeStyle(theme)} aria-hidden="true">
    <div className="look-mock-header">{logo && <img className="brand-logo" src={logo} alt="" />}<span><strong>{name}</strong><small>{draft.tagline}</small></span></div>
    <nav className="look-mock-nav">{['Calendar', 'Updates', 'Board', 'Tasks', 'Lists', 'Files'].map((item, i) => <button key={item} tabIndex={-1} className={i === 2 ? 'primary' : 'secondary'}>{item}</button>)}</nav>
    <div className="today-banner"><div><span className="eyebrow">Today</span><h2>Good morning</h2><p>Three tasks are due this week.</p></div></div>
    <div className="panel"><h2>Board <span className="pill">New</span></h2><p>Venue walk-through moved to Thursday at 10. Bring the floor plans.</p>
      <p className="muted-text">Posted by the producer · <a>2 replies</a></p>
      <label>Reply<input readOnly tabIndex={-1} value="I can bring the plans." /></label>
      <div className="action-row"><button className="primary" tabIndex={-1}>Post</button><button className="secondary" tabIndex={-1}>Cancel</button><span className="badge">Volunteers</span></div>
      <p className="error">The schedule needs one more volunteer.</p></div>
  </div>
}

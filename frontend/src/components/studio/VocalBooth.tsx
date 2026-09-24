import { useEffect, useRef, useState } from 'react'
import { AudioRecorder } from './AudioRecorder'
import { apiUrl, request } from '../../lib/api'
import { DownloadButton } from '../DownloadButton'
import { DEMO } from '../../lib/demo/flag'
import { getDemoAudioUrl } from '../../lib/demo/audioAssets'

const UPLOAD_SENTINEL = '__upload_new__'

interface VocalBoothProps {
  onSendToEffects: (blob: Blob) => void
  onSendToVoice: (blob: Blob) => void
  onOpenEffects: () => void
  onOpenVoice: () => void
}

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16,
}

const stepButton: React.CSSProperties = {
  padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface2)',
  color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
}

function ScriptToVoice({ onSendToEffects }: { onSendToEffects: (blob: Blob) => void }) {
  const referenceRef = useRef<HTMLInputElement>(null)
  const [script, setScript] = useState('')
  const [voices, setVoices] = useState<string[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState<string>(UPLOAD_SENTINEL)
  const [reference, setReference] = useState<File | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [exaggeration, setExaggeration] = useState(0.45)
  const [cfgWeight, setCfgWeight] = useState(0.5)
  const [consent, setConsent] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [error, setError] = useState('')

  async function loadVoices(preferSelect?: string) {
    setVoicesLoading(true)
    try {
      const data = await request<{ voices: string[] }>('/tools/chatterbox/voices')
      const list = data.voices ?? []
      setVoices(list)
      if (preferSelect && list.includes(preferSelect)) setSelectedVoice(preferSelect)
      else if (selectedVoice !== UPLOAD_SENTINEL && !list.includes(selectedVoice)) setSelectedVoice(UPLOAD_SENTINEL)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not load saved voices.') }
    finally { setVoicesLoading(false) }
  }

  // Fetch-on-mount only — intentionally not re-run when selectedVoice (read
  // inside loadVoices) changes later from user selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void loadVoices() }, [])

  async function saveVoice() {
    if (!saveName.trim() || !reference) return
    setSaving(true); setError('')
    const form = new FormData()
    form.append('name', saveName.trim())
    form.append('audio', reference)
    try {
      const saved = await request<{ name: string }>('/tools/chatterbox/voices', { method: 'POST', body: form })
      setSaveName('')
      await loadVoices(saved.name)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not save this voice.') }
    finally { setSaving(false) }
  }

  async function deleteVoice(name: string) {
    try {
      await request(`/tools/chatterbox/voices/${name}`, { method: 'DELETE' })
      if (selectedVoice === name) setSelectedVoice(UPLOAD_SENTINEL)
      await loadVoices()
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not remove that voice.') }
  }

  async function generate() {
    const usingSaved = selectedVoice !== UPLOAD_SENTINEL
    if (!script.trim() || !consent || (!usingSaved && !reference)) return
    setGenerating(true); setError(''); setAudioUrl('')
    setStatus(usingSaved ? `Generating as ${selectedVoice}…` : 'Uploading script and voice reference…')
    const form = new FormData()
    form.append('text', script.trim())
    if (usingSaved) form.append('voice_name', selectedVoice)
    else if (reference) form.append('reference_audio', reference)
    form.append('exaggeration', String(exaggeration))
    form.append('cfg_weight', String(cfgWeight))
    try {
      const start = await fetch('/api/tools/chatterbox/jobs', { method: 'POST', body: form })
      const created = await start.json()
      if (!start.ok) throw new Error(created.detail || 'Could not start voice generation.')
      setStatus('Generating in the chosen voice… longer scripts are safely split into short passages.')
      for (let attempt = 0; attempt < 240; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const jobResponse = await fetch('/api/tools/jobs/' + created.job_id)
        const job = await jobResponse.json()
        if (job.status === 'done') {
          // <audio src> (and DownloadButton/"Send to Effects" below, which all read this
          // same state) bypasses window.fetch entirely — a real local blob: URL in demo
          // mode instead of an /api/... path with nothing behind it.
          setAudioUrl(DEMO ? (getDemoAudioUrl(created.job_id) ?? '') : apiUrl('/api/tools/jobs/' + created.job_id + '/file'))
          setStatus('')
          return
        }
        if (job.status === 'error') throw new Error(job.error || 'Voice generation failed.')
      }
      throw new Error('Generation is still running. Try a shorter script or check the jobs panel.')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Voice generation failed.')
      setStatus('')
    } finally { setGenerating(false) }
  }

  async function sendToEffects() {
    if (!audioUrl) return
    try {
      const response = await fetch(audioUrl)
      if (!response.ok) throw new Error('Could not load the generated WAV.')
      onSendToEffects(await response.blob())
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not send the WAV to Effects Rack.') }
  }

  const usingSaved = selectedVoice !== UPLOAD_SENTINEL
  const ready = !!script.trim() && consent && !generating && (usingSaved || !!reference)
  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 700, letterSpacing: '.06em' }}>SCRIPT TO VOICE</div><h3 style={{ margin: '5px 0 0', fontSize: 16 }}>Generate narration in any saved voice</h3></div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Chatterbox zero-shot voice clone</span>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>Paste a script, pick a saved voice from the dropdown (or upload a one-off reference clip), then generate a WAV. This does not require an RVC model.</p>
      <textarea value={script} onChange={event => setScript(event.target.value)} placeholder="Paste narration, dialogue, or a podcast segment…" rows={6} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', font: 'inherit', fontSize: 13, lineHeight: 1.45 }} />

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Voice</label>
        <select
          value={selectedVoice}
          onChange={event => setSelectedVoice(event.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13 }}
        >
          <option value={UPLOAD_SENTINEL}>Upload a one-off reference clip…</option>
          {voices.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        {voicesLoading && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Loading saved voices…</p>}
        {usingSaved && (
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={() => void deleteVoice(selectedVoice)} style={{ ...stepButton, fontSize: 11, padding: '4px 9px', color: 'var(--danger)' }}>Remove "{selectedVoice}" from library</button>
          </div>
        )}
      </div>

      {!usingSaved && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <input ref={referenceRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={event => setReference(event.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => referenceRef.current?.click()} style={stepButton}>{reference ? '✓ ' + reference.name : 'Choose reference WAV'}</button>
          {reference && (
            <>
              <input value={saveName} onChange={event => setSaveName(event.target.value)} placeholder="Save as… (name)" aria-label="Save voice as" style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, width: 160 }} />
              <button type="button" disabled={!saveName.trim() || saving} onClick={() => void saveVoice()} style={{ ...stepButton, opacity: saveName.trim() && !saving ? 1 : 0.55 }}>{saving ? 'Saving…' : 'Save to voice list'}</button>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> I own this voice or have clear permission to clone it.</label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginTop: 12 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Expressiveness: {exaggeration.toFixed(2)}<input type="range" min={0.2} max={0.8} step={0.05} value={exaggeration} onChange={event => setExaggeration(Number(event.target.value))} style={{ display: 'block', width: '100%', marginTop: 5, accentColor: 'var(--accent)' }} /></label>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pacing: {cfgWeight.toFixed(2)}<input type="range" min={0.2} max={1} step={0.05} value={cfgWeight} onChange={event => setCfgWeight(Number(event.target.value))} style={{ display: 'block', width: '100%', marginTop: 5, accentColor: 'var(--accent)' }} /></label>
      </div>
      <button type="button" disabled={!ready} onClick={() => void generate()} style={{ ...stepButton, marginTop: 14, background: ready ? 'var(--accent)' : 'var(--surface2)', borderColor: ready ? 'var(--accent)' : 'var(--border)', color: ready ? '#fff' : 'var(--text-muted)', cursor: ready ? 'pointer' : 'not-allowed' }}>{generating ? 'Generating your WAV…' : usingSaved ? `Generate as ${selectedVoice}` : 'Generate WAV'}</button>
      {status && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--accent2)' }}>{status}</p>}
      {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
      {audioUrl && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}><audio controls src={audioUrl} style={{ flex: '1 1 280px', height: 34 }} /><DownloadButton url={audioUrl} filename={(usingSaved ? selectedVoice : 'script') + '.wav'} style={stepButton}>Download WAV</DownloadButton><button type="button" onClick={() => void sendToEffects()} style={{ ...stepButton, borderColor: 'var(--accent)', color: 'var(--accent)' }}>Send to Effects Rack →</button></div>}
      {audioUrl && DEMO && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>Demo note: this is a procedurally synthesized placeholder, not the real Chatterbox voice-cloning model.</p>}
    </section>
  )
}

export function VocalBooth({ onSendToEffects, onSendToVoice, onOpenEffects, onOpenVoice }: VocalBoothProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ ...card, background: 'linear-gradient(135deg, rgba(124,110,247,0.18), rgba(94,234,212,0.06))' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 30, lineHeight: 1 }}>🎙️</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Vocal Booth</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
              Make a clean master take, create distinctive versions with your own consented voice profiles, and export WAV files ready for podcasts, narration, or video timelines.
            </p>
          </div>
          <span style={{ border: '1px solid rgba(94,234,212,0.45)', color: 'var(--accent2)', borderRadius: 20, padding: '4px 9px', fontSize: 11 }}>Podcast-ready workflow</span>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={{ color: 'var(--accent2)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em' }}>01 · CAPTURE</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: 14 }}>Record a clean master</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 }}>Leave a second of room tone, speak naturally, then trim the take below.</p>
        </div>
        <div style={card}>
          <div style={{ color: 'var(--accent2)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em' }}>02 · SHAPE</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: 14 }}>Polish the signal</h3>
          <p style={{ margin: '0 0 10px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 }}>Use EQ, compression, and subtle ambience to make a reusable show sound.</p>
          <button style={stepButton} onClick={onOpenEffects}>Open effects rack →</button>
        </div>
        <div style={card}>
          <div style={{ color: 'var(--accent2)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em' }}>03 · CHARACTER</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: 14 }}>Audition voice profiles</h3>
          <p style={{ margin: '0 0 10px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 }}>Import only voices you own or have permission to use, then compare model, pitch, and index settings.</p>
          <button style={stepButton} onClick={onOpenVoice}>Manage voice profiles →</button>
        </div>
      </section>

      <ScriptToVoice onSendToEffects={onSendToEffects} />

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 700, letterSpacing: '.06em' }}>LIVE TAKE</div>
            <h3 style={{ margin: '5px 0 0', fontSize: 16 }}>Record, review, then choose your route</h3>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>WAV master · non-destructive workflow</span>
        </div>
        <AudioRecorder onSendToEffects={onSendToEffects} onSendToVoice={onSendToVoice} />
      </section>

      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Tip: save one clean, unprocessed master for every session. Make filters and profile conversions from that master so you can revisit each episode’s sound later.
      </p>
    </div>
  )
}

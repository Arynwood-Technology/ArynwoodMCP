import { useEffect, useRef, useState } from 'react'
import { request } from '../../lib/api'

interface VoiceModel { name: string; has_index: boolean }
type Status = 'idle' | 'running' | 'completed' | 'failed'

interface VoiceConversionProps {
  sidecarReady: boolean
  externalFile?: Blob | null
  onExternalFileConsumed?: () => void
  onSendToEffects?: (blob: Blob) => void
}

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }
const button: React.CSSProperties = { padding: '8px 13px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }

export function VoiceConversion({ sidecarReady, externalFile, onExternalFileConsumed, onSendToEffects }: VoiceConversionProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const pthRef = useRef<HTMLInputElement>(null)
  const indexRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [models, setModels] = useState<VoiceModel[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [pitchShift, setPitchShift] = useState(0)
  const [indexRate, setIndexRate] = useState(0.65)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [importName, setImportName] = useState('')
  const [importPth, setImportPth] = useState<File | null>(null)
  const [importIndex, setImportIndex] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  async function loadModels() {
    if (!sidecarReady) return
    setModelsLoading(true)
    try {
      const data = await request<{ models: VoiceModel[] }>('/studio/voice/models')
      const list = data.models ?? []
      setModels(list)
      setSelectedModel(current => current || list[0]?.name || '')
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not load voice profiles.') }
    finally { setModelsLoading(false) }
  }

  // Fetch whenever the sidecar comes online (loadModels itself no-ops if not
  // ready) — intentionally not re-run on other state loadModels reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void loadModels() }, [sidecarReady])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])
  useEffect(() => {
    if (!externalFile) return
    // Notifies the parent (onExternalFileConsumed) once the file's adopted —
    // has to run as an effect, not during render, to avoid updating the
    // parent's state synchronously while this component is rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFile(new File([externalFile], 'booth-take.wav', { type: 'audio/wav' }))
    setStatus('idle'); setJobId(null); setError('')
    onExternalFileConsumed?.()
  }, [externalFile, onExternalFileConsumed])

  async function startConversion() {
    if (!file || !selectedModel) return
    setStatus('running'); setProgress(0); setError(''); setJobId(null)
    const form = new FormData()
    form.append('audio', file)
    form.append('model_name', selectedModel)
    form.append('pitch_shift', String(pitchShift))
    form.append('index_rate', String(indexRate))
    try {
      const data = await request<{ job_id: string }>('/studio/voice/convert', { method: 'POST', body: form })
      setJobId(data.job_id)
      pollRef.current = setInterval(async () => {
        try {
          const update = await request<{ status: string; progress: number; error?: string }>(`/studio/voice/convert/${data.job_id}`)
          setProgress(update.progress ?? 0)
          if (update.status === 'completed') { if (pollRef.current) clearInterval(pollRef.current); setStatus('completed') }
          if (update.status === 'failed') { if (pollRef.current) clearInterval(pollRef.current); setStatus('failed'); setError(update.error ?? 'Conversion failed.') }
        } catch { /* keep polling through transient errors */ }
      }, 1200)
    } catch (cause: unknown) { setStatus('failed'); setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function sendResultToEffects() {
    if (!jobId || !onSendToEffects) return
    try {
      const response = await fetch(`/api/studio/voice/convert/${jobId}/result`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      onSendToEffects(await response.blob())
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not pass result to Character Effects.') }
  }

  async function importModel() {
    if (!importName.trim()) { setError('Give this trained voice profile a name first.'); return }
    if (!importPth) { setError('Choose a trained RVC .pth model to import. A WAV is training audio, not an importable profile.'); return }
    setImporting(true); setError('')
    const form = new FormData()
    form.append('name', importName.trim()); form.append('pth', importPth)
    if (importIndex) form.append('index', importIndex)
    try {
      await request('/studio/voice/models/import', { method: 'POST', body: form })
      setImportName(''); setImportPth(null); setImportIndex(null); await loadModels()
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Profile import failed.') }
    finally { setImporting(false) }
  }

  async function deleteModel(name: string) {
    try { await request(`/studio/voice/models/${name}`, { method: 'DELETE' }); if (selectedModel === name) setSelectedModel(''); await loadModels() }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not remove profile.') }
  }

  const canRender = sidecarReady && !!file && !!selectedModel && status !== 'running'
  const importReady = !!importName.trim() && !!importPth
  const resultUrl = jobId ? `/api/studio/voice/convert/${jobId}/result` : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
      <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={event => { const picked = event.target.files?.[0]; if (picked) { setFile(picked); setStatus('idle'); setJobId(null) } }} />
      <input ref={pthRef} type="file" accept=".pth" style={{ display: 'none' }} onChange={event => setImportPth(event.target.files?.[0] ?? null)} />
      <input ref={indexRef} type="file" accept=".index" style={{ display: 'none' }} onChange={event => setImportIndex(event.target.files?.[0] ?? null)} />

      <section style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(124,110,247,0.16), rgba(94,234,212,0.04))' }}>
        <div style={label}>Character lab · 3-step render</div>
        <h2 style={{ margin: '6px 0', fontSize: 20 }}>Make a new performance from one clean take</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>Profile conversion changes the character; Character Effects adds the space, radio, robot, or cartoon treatment after rendering.</p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, .85fr) minmax(300px, 1.4fr)', gap: 14 }}>
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={label}>1 · Source take</div>
          <div style={{ fontSize: 14, fontWeight: 600, margin: '10px 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file?.name ?? 'No take selected'}</div>
          <p style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)', margin: '0 0 12px' }}>{file ? 'Received from the Vocal Booth. You can replace it if needed.' : 'Record in Vocal Booth or choose a saved WAV/MP3.'}</p>
          <button style={button} onClick={() => fileRef.current?.click()}>{file ? 'Replace take' : 'Choose a take'}</button>
        </div>
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={label}>2 · Character profile</div>
          {modelsLoading ? <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading profiles…</p> : models.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 10 }}>
              {models.map(model => <button key={model.name} onClick={() => setSelectedModel(model.name)} style={{ textAlign: 'left', padding: '10px', borderRadius: 8, border: selectedModel === model.name ? '1px solid var(--accent)' : '1px solid var(--border)', background: selectedModel === model.name ? 'rgba(124,110,247,0.16)' : 'var(--surface2)', color: 'var(--text)', cursor: 'pointer' }}><strong style={{ display: 'block', fontSize: 12 }}>{model.name}</strong><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{model.has_index ? 'Detailed profile' : 'Voice profile'}</span></button>)}
            </div>
          ) : <p style={{ color: 'var(--warning)', fontSize: 12, lineHeight: 1.5 }}>No profiles yet. Add a voice you own or have clear permission to use in the Profile Library below.</p>}
        </div>
      </section>

      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
        <div style={label}>3 · Performance shape</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 1fr) minmax(230px, 1fr)', gap: 22, marginTop: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Character size <strong style={{ color: 'var(--text)', float: 'right' }}>{pitchShift > 0 ? '+' : ''}{pitchShift} semitones</strong><input type="range" min={-12} max={12} step={0.5} value={pitchShift} onChange={event => setPitchShift(Number(event.target.value))} style={{ display: 'block', width: '100%', marginTop: 8, accentColor: 'var(--accent)' }} /><span style={{ fontSize: 10 }}>Lower = larger / higher = smaller</span></label>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Profile detail <strong style={{ color: 'var(--text)', float: 'right' }}>{Math.round(indexRate * 100)}%</strong><input type="range" min={0} max={1} step={0.05} value={indexRate} onChange={event => setIndexRate(Number(event.target.value))} style={{ display: 'block', width: '100%', marginTop: 8, accentColor: 'var(--accent)' }} /><span style={{ fontSize: 10 }}>Start at 65%; reduce if it sounds overprocessed.</span></label>
        </div>
        <button disabled={!canRender} onClick={startConversion} style={{ marginTop: 18, padding: '10px 20px', border: 'none', borderRadius: 8, background: canRender ? 'var(--accent)' : 'var(--surface2)', color: canRender ? '#fff' : 'var(--text-muted)', cursor: canRender ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700 }}>{status === 'running' ? `Rendering ${progress}%…` : 'Render character voice'}</button>
        {status === 'running' && <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden', marginTop: 10 }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', transition: 'width .3s' }} /></div>}
      </section>

      {status === 'completed' && jobId && <section style={{ padding: 16, border: '1px solid rgba(94,234,212,.38)', borderRadius: 10, background: 'rgba(94,234,212,.05)' }}><div style={label}>4 · Review and finish</div><div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}><audio controls src={resultUrl} style={{ flex: '1 1 320px', height: 34 }} /><a href={resultUrl} download="character-voice.wav"><button style={button}>Download WAV</button></a><button style={{ ...button, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={sendResultToEffects}>Send to Character Effects →</button></div></section>}
      {error && <div style={{ padding: '10px 14px', border: '1px solid var(--danger)', borderRadius: 8, color: 'var(--danger)', fontSize: 12, background: 'rgba(239,68,68,.08)' }}>{error}</div>}
      {!sidecarReady && <div style={{ padding: '10px 14px', border: '1px solid var(--warning)', borderRadius: 8, color: 'var(--warning)', fontSize: 12 }}>Start the Voice Conversion sidecar above to use Character Lab.</div>}

      <details style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>Profile Library — import a finished RVC voice model</summary>
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(124,110,247,.08)', border: '1px solid rgba(124,110,247,.2)', fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>This is not the training step.</strong> Import accepts a trained RVC <code>.pth</code> checkpoint (plus its optional <code>.index</code>). A recording of the voice (for example <code>my-voice.wav</code>) is used to train that model first.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <input value={importName} onChange={event => setImportName(event.target.value)} placeholder="Profile name" aria-label="Profile name" style={{ width: 150 }} />
          <button type="button" style={button} onClick={() => pthRef.current?.click()}>{importPth ? '✓ ' + importPth.name : 'Choose trained .pth'}</button>
          <button type="button" style={button} onClick={() => indexRef.current?.click()}>{importIndex ? '✓ ' + importIndex.name : 'Optional .index'}</button>
          <button type="button" style={{ ...button, background: importing ? 'var(--surface2)' : 'var(--accent)', borderColor: importing ? 'var(--border)' : 'var(--accent)', color: importing ? 'var(--text-muted)' : '#fff', opacity: importReady || importing ? 1 : .55 }} disabled={importing} onClick={importModel}>{importing ? 'Importing…' : importReady ? 'Import trained profile' : 'Choose a .pth to import'}</button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>To create a voice profile from your own recording: train an RVC model first, then return here and select the exported <code>weights/your-voice.pth</code>.</p>
        {models.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>{models.map(model => <span key={model.name} style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>{model.name} <button type="button" onClick={() => deleteModel(model.name)} style={{ marginLeft: 5, border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer' }}>×</button></span>)}</div>}
      </details>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Guitar, Loader2, Upload } from 'lucide-react'
import { getMusicAssets, getMusicCapabilities } from '../../lib/api'
import type { MusicAsset, MusicCapabilities } from '../../lib/api'
import { useMusicJobStore } from '../../store/useMusicJobStore'
import { useMusicJobPoll } from './useMusicJobPoll'
import { MusicAssetCard } from './MusicAssetCard'
import { AudioRecorder } from './AudioRecorder'

const ROLES = [
  'Bass player', 'Drummer', 'Guitarist', 'Keyboard player', 'String player',
  'Soloist', 'Accompaniment', 'Countermelody', 'Full band',
]

type InputMode = 'record' | 'upload' | 'existing'

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const fieldCaption: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)' }
const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }
const button: React.CSSProperties = { padding: '8px 13px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
// How each provider actually "listens" to the input — set real expectations
// rather than implying any provider follows the input note-for-note.
// MusicGen's melody conditioning runs Demucs internally and keeps only the
// vocals/other stems before extracting a chroma (harmonic) signal — drums
// and bass are discarded outright, and even melodic content becomes a rough
// harmonic guide rather than a literal transcription. Confirmed against the
// installed audiocraft source (ChromaStemConditioner in conditioners.py).
const PROVIDER_LISTENING_NOTES: Record<string, string> = {
  musicgen: 'MusicGen "hears" your input as a rough harmonic outline, not a literal recording: it strips out drums and bass internally before listening, and even melodic parts (vocals, guitar) only guide the response loosely — expect an impression of your take, not a precise reply to it. Vocal/guitar/synth input works better than bass- or drum-heavy input.',
}

const chip = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
  border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
  background: active ? 'rgba(124,110,247,0.16)' : 'var(--surface2)',
  color: disabled ? 'var(--text-muted)' : active ? 'var(--accent)' : 'var(--text)',
  opacity: disabled ? 0.5 : 1,
})

interface JamWithAIProps {
  sidecarReady: boolean
}

export function JamWithAI({ sidecarReady }: JamWithAIProps) {
  const [capabilities, setCapabilities] = useState<MusicCapabilities | null>(null)
  const [assets, setAssets] = useState<MusicAsset[]>([])
  const [myJobIds, setMyJobIds] = useState<string[]>([])
  const [error, setError] = useState('')

  const [inputMode, setInputMode] = useState<InputMode>('record')
  const [pendingInputBlob, setPendingInputBlob] = useState<Blob | null>(null)
  const [selectedInputAssetId, setSelectedInputAssetId] = useState<string | null>(null)

  const [role, setRole] = useState(ROLES[0])
  const [provider, setProvider] = useState('')
  const [style, setStyle] = useState('')
  const [bpm, setBpm] = useState('')
  const [key, setKey] = useState('')
  const [duration, setDuration] = useState(15)

  const { start } = useMusicJobPoll()
  const jobs = useMusicJobStore(s => s.jobs)

  async function loadCapabilities() {
    try { setCapabilities(await getMusicCapabilities()) }
    catch { /* song-gen sidecar down — providers list stays empty, handled below */ }
  }
  async function loadAssets() {
    try { setAssets(await getMusicAssets()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load asset library') }
  }
  // Fetch-on-mount: load the provider list + asset library once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadCapabilities(); void loadAssets() }, [])

  // Jam mode only makes sense with a provider that actually listens to the
  // input — ACE-Step's audio_conditioning is false today, so offering it here
  // would silently ignore whatever was recorded/uploaded. Restrict the choice
  // instead of offering a provider that can't do the thing this tab is for.
  const jamProviders = useMemo(
    () => (capabilities?.providers ?? []).filter(p => p.supports.melody_conditioning),
    [capabilities],
  )
  useEffect(() => {
    // Picks a default provider once the filtered list arrives; guarded by
    // !provider so it only fires once and never overrides a user's own pick.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!provider && jamProviders.length) setProvider(jamProviders.find(p => p.installed)?.id ?? jamProviders[0].id)
  }, [jamProviders, provider])

  // Job completion is driven by useMusicJobPoll's background interval, which
  // writes into useMusicJobStore — this just reacts once one of our own jobs
  // lands on 'done' and refreshes the library so the new result appears.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (myJobIds.some(id => jobs[id]?.status === 'done')) void loadAssets()
  }, [jobs, myJobIds])

  const selectedProvider = jamProviders.find(p => p.id === provider)
  const hasInput = !!pendingInputBlob || !!selectedInputAssetId
  const canJam = sidecarReady && !!provider && !!selectedProvider?.installed && hasInput

  const inputPreviewUrl = useMemo(() => {
    if (pendingInputBlob) return URL.createObjectURL(pendingInputBlob)
    if (selectedInputAssetId) return `/api/music/assets/${selectedInputAssetId}/audio`
    return null
  }, [pendingInputBlob, selectedInputAssetId])
  useEffect(() => () => { if (pendingInputBlob && inputPreviewUrl) URL.revokeObjectURL(inputPreviewUrl) }, [pendingInputBlob, inputPreviewUrl])

  function pickInputBlob(blob: Blob) {
    setPendingInputBlob(blob)
    setSelectedInputAssetId(null)
  }
  function pickInputAsset(id: string) {
    setSelectedInputAssetId(id)
    setPendingInputBlob(null)
  }

  async function handleJam() {
    setError('')
    if (!hasInput) { setError('Record, upload, or pick an existing take first.'); return }
    const form = new FormData()
    form.append('provider', provider)
    form.append('role', role)
    if (style) form.append('style', style)
    if (bpm) form.append('bpm', bpm)
    if (key) form.append('key', key)
    form.append('duration_seconds', String(duration))
    if (pendingInputBlob) form.append('input_audio', pendingInputBlob, 'jam_input.wav')
    else if (selectedInputAssetId) form.append('input_asset_id', selectedInputAssetId)

    const jobId = await start('/api/music/jam', form)
    if (jobId) setMyJobIds(ids => [...ids, jobId])
    else setError('Could not start the jam session.')
  }

  const inFlight = myJobIds
    .map(id => ({ id, job: jobs[id] }))
    .filter((x): x is { id: string; job: NonNullable<typeof jobs[string]> } =>
      !!x.job && (x.job.status === 'queued' || x.job.status === 'running'))
  const responses = assets.filter(a => a.kind === 'jam_response')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
      <section style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(124,110,247,0.16), rgba(94,234,212,0.04))' }}>
        <div style={label}>What are you giving the AI?</div>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Record, upload, or pick a take, then ask the AI to respond as a bandmate. The response always lands
          as its own separate track — it's never merged into your recording.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button style={chip(inputMode === 'record')} onClick={() => setInputMode('record')}>Record</button>
          <button style={chip(inputMode === 'upload')} onClick={() => setInputMode('upload')}>Upload</button>
          <button style={chip(inputMode === 'existing')} onClick={() => setInputMode('existing')}>Existing asset</button>
        </div>

        {inputMode === 'record' && (
          <div style={{ marginTop: 14 }}>
            <AudioRecorder onSendToEffects={pickInputBlob} onSendToJam={pickInputBlob} />
          </div>
        )}
        {inputMode === 'upload' && (
          <div style={{ marginTop: 14 }}>
            <label style={button}>
              <Upload size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {pendingInputBlob instanceof File ? `✓ ${pendingInputBlob.name}` : 'Choose an audio file'}
              <input type="file" accept="audio/*" style={{ display: 'none' }}
                     onChange={e => { const f = e.target.files?.[0]; if (f) pickInputBlob(f) }} />
            </label>
          </div>
        )}
        {inputMode === 'existing' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 14 }}>
            {assets.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No assets in your library yet.</span>}
            {assets.map(a => (
              <button key={a.id} onClick={() => pickInputAsset(a.id)} style={chip(selectedInputAssetId === a.id)}>
                {a.label}
              </button>
            ))}
          </div>
        )}

        {inputPreviewUrl && (
          <div style={{ marginTop: 14 }}>
            <span style={fieldCaption}>Input preview</span>
            <audio controls src={inputPreviewUrl} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </div>
        )}
      </section>

      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
        <div style={label}>AI role</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {ROLES.map(r => <button key={r} onClick={() => setRole(r)} style={chip(role === r)}>{r}</button>)}
        </div>
      </section>

      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
        <div style={label}>Provider</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {jamProviders.map(p => (
            <button key={p.id} disabled={!p.installed} onClick={() => setProvider(p.id)}
                    title={p.installed ? p.license : (p.message ?? 'Not installed')}
                    style={chip(provider === p.id, !p.installed)}>
              {p.label}{!p.installed && ' (not installed)'}{p.license.includes('NC') && ' · non-commercial'}
            </button>
          ))}
          {!jamProviders.length && (
            <span style={{ fontSize: 12, color: 'var(--warning)' }}>
              No provider with audio-conditioning is installed yet — Jam needs a provider that can actually
              listen to your input (currently MusicGen; run setup_song_gen.sh --with-musicgen).
            </span>
          )}
        </div>
        {provider && PROVIDER_LISTENING_NOTES[provider] && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '10px 0 0' }}>
            {PROVIDER_LISTENING_NOTES[provider]}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 14 }}>
          <div style={fieldWrap}><span style={fieldCaption}>Style</span><input style={input} value={style} onChange={e => setStyle(e.target.value)} placeholder="post-punk" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>BPM</span><input style={input} type="number" value={bpm} onChange={e => setBpm(e.target.value)} placeholder="118" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>Key</span><input style={input} value={key} onChange={e => setKey(e.target.value)} placeholder="E minor" /></div>
          <div style={fieldWrap}>
            <span style={fieldCaption}>Duration: {duration}s</span>
            <input type="range" min={5} max={selectedProvider?.max_duration_seconds ?? 30} value={duration}
                   onChange={e => setDuration(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
          </div>
        </div>

        <button
          disabled={!canJam}
          onClick={handleJam}
          style={{ marginTop: 16, padding: '10px 20px', border: 'none', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
            background: canJam ? 'var(--accent)' : 'var(--surface2)', color: canJam ? '#fff' : 'var(--text-muted)',
            cursor: canJam ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700 }}
        >
          <Guitar size={14} /> Generate response
        </button>
        {!sidecarReady && <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>Start the Song Generation sidecar above first.</p>}
        {!hasInput && sidecarReady && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Record, upload, or pick a take above to jam with.</p>}
      </section>

      {inFlight.length > 0 && (
        <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={label}>Generating response</div>
          {inFlight.map(({ id, job }) => (
            <div key={id} style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>
                  <Loader2 size={12} style={{ verticalAlign: 'middle', marginRight: 6, animation: 'spin 1s linear infinite' }} />
                  {role} — {job.status}
                </span>
                <span>{job.progress}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                <div style={{ height: '100%', width: `${job.progress}%`, background: 'var(--accent)', transition: 'width .3s' }} />
              </div>
            </div>
          ))}
        </section>
      )}

      {error && <div style={{ padding: '10px 14px', border: '1px solid var(--danger)', borderRadius: 8, color: 'var(--danger)', fontSize: 12, background: 'rgba(239,68,68,.08)' }}>{error}</div>}

      <section>
        <div style={label}>Responses</div>
        {responses.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>No responses yet — jam with the AI above.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginTop: 10 }}>
            {responses.map(asset => (
              <MusicAssetCard
                key={asset.id}
                asset={asset}
                onChanged={loadAssets}
                onRegenerated={jobId => setMyJobIds(ids => [...ids, jobId])}
                supportsExtend={selectedProvider?.supports.continuation}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { getMusicAssets, getMusicCapabilities } from '../../lib/api'
import type { MusicAsset, MusicCapabilities } from '../../lib/api'
import { useMusicJobStore } from '../../store/useMusicJobStore'
import { useMusicJobPoll } from './useMusicJobPoll'
import { MusicAssetCard } from './MusicAssetCard'

const INSTRUMENTS = ['Bass', 'Drums', 'Guitar', 'Piano', 'Synth', 'Strings', 'Percussion', 'Other', 'Full arrangement']

const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const fieldCaption: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)' }
const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }
const button: React.CSSProperties = { padding: '8px 13px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const chip = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
  border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
  background: active ? 'rgba(124,110,247,0.16)' : 'var(--surface2)',
  color: disabled ? 'var(--text-muted)' : active ? 'var(--accent)' : 'var(--text)',
  opacity: disabled ? 0.5 : 1,
})

interface InstrumentGeneratorProps {
  sidecarReady: boolean
}

export function InstrumentGenerator({ sidecarReady }: InstrumentGeneratorProps) {
  const [capabilities, setCapabilities] = useState<MusicCapabilities | null>(null)
  const [assets, setAssets] = useState<MusicAsset[]>([])
  const [myJobIds, setMyJobIds] = useState<string[]>([])
  const [error, setError] = useState('')

  const [instrument, setInstrument] = useState('Bass')
  const [provider, setProvider] = useState('')
  const [genre, setGenre] = useState('')
  const [style, setStyle] = useState('')
  const [mood, setMood] = useState('')
  const [bpm, setBpm] = useState('')
  const [key, setKey] = useState('')
  const [duration, setDuration] = useState(15)
  const [energy, setEnergy] = useState('')
  const [complexity, setComplexity] = useState('')
  const [prompt, setPrompt] = useState('')
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [melodyFile, setMelodyFile] = useState<File | null>(null)

  const { start } = useMusicJobPoll()
  const jobs = useMusicJobStore(s => s.jobs)

  async function loadCapabilities() {
    try { setCapabilities(await getMusicCapabilities()) }
    catch { /* song-gen sidecar down — providers list stays empty, handled in the UI below */ }
  }
  async function loadAssets() {
    try { setAssets(await getMusicAssets({ kind: 'generated' })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load asset library') }
  }

  useEffect(() => { void loadCapabilities(); void loadAssets() }, [])

  useEffect(() => {
    const provs = capabilities?.providers ?? []
    if (!provider && provs.length) setProvider(provs.find(p => p.installed)?.id ?? provs[0].id)
  }, [capabilities, provider])

  // Job completion is driven by useMusicJobPoll's background interval, which
  // writes into useMusicJobStore — this just reacts once one of our own jobs
  // lands on 'done' and refreshes the library so the new result appears.
  useEffect(() => {
    if (myJobIds.some(id => jobs[id]?.status === 'done')) void loadAssets()
  }, [jobs, myJobIds])

  const selectedProvider = capabilities?.providers.find(p => p.id === provider)
  const canGenerate = sidecarReady && !!provider && !!selectedProvider?.installed

  async function handleGenerate() {
    setError('')
    const form = new FormData()
    form.append('provider', provider)
    form.append('instrument', instrument)
    if (genre) form.append('genre', genre)
    if (style) form.append('style', style)
    if (mood) form.append('mood', mood)
    if (bpm) form.append('bpm', bpm)
    if (key) form.append('key', key)
    form.append('duration_seconds', String(duration))
    if (energy) form.append('energy', energy)
    if (complexity) form.append('complexity', complexity)
    if (prompt) form.append('prompt', prompt)
    if (referenceFile) form.append('reference_audio', referenceFile)
    if (melodyFile) form.append('melody_audio', melodyFile)

    const jobId = await start('/api/music/generate', form)
    if (jobId) setMyJobIds(ids => [...ids, jobId])
    else setError('Could not start generation.')
  }

  const inFlight = myJobIds
    .map(id => ({ id, job: jobs[id] }))
    .filter((x): x is { id: string; job: NonNullable<typeof jobs[string]> } =>
      !!x.job && (x.job.status === 'queued' || x.job.status === 'running'))
  const filteredAssets = assets.filter(a => a.instrument === instrument)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
      <section style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(124,110,247,0.16), rgba(94,234,212,0.04))' }}>
        <div style={label}>What are you playing?</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {INSTRUMENTS.map(i => (
            <button key={i} onClick={() => setInstrument(i)} style={chip(instrument === i)}>{i}</button>
          ))}
        </div>
      </section>

      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
        <div style={label}>Provider</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(capabilities?.providers ?? []).map(p => (
            <button
              key={p.id}
              disabled={!p.installed}
              onClick={() => setProvider(p.id)}
              title={p.installed ? p.license : (p.message ?? 'Not installed')}
              style={chip(provider === p.id, !p.installed)}
            >
              {p.label}{!p.installed && ' (not installed)'}{p.license.includes('NC') && ' · non-commercial'}
            </button>
          ))}
          {!capabilities?.providers.length && (
            <span style={{ fontSize: 12, color: 'var(--warning)' }}>Start the Song Generation sidecar above to see available providers.</span>
          )}
        </div>
      </section>

      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
        <div style={label}>What should it do?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
          <div style={fieldWrap}><span style={fieldCaption}>Genre</span><input style={input} value={genre} onChange={e => setGenre(e.target.value)} placeholder="synthwave" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>Style</span><input style={input} value={style} onChange={e => setStyle(e.target.value)} placeholder="dark, driving" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>Mood</span><input style={input} value={mood} onChange={e => setMood(e.target.value)} placeholder="tense" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>BPM</span><input style={input} type="number" value={bpm} onChange={e => setBpm(e.target.value)} placeholder="120" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>Key</span><input style={input} value={key} onChange={e => setKey(e.target.value)} placeholder="A minor" /></div>
          <div style={fieldWrap}>
            <span style={fieldCaption}>Duration: {duration}s</span>
            <input type="range" min={5} max={selectedProvider?.max_duration_seconds ?? 30} value={duration}
                   onChange={e => setDuration(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
          </div>
          <div style={fieldWrap}><span style={fieldCaption}>Energy</span><input style={input} value={energy} onChange={e => setEnergy(e.target.value)} placeholder="high" /></div>
          <div style={fieldWrap}><span style={fieldCaption}>Complexity</span><input style={input} value={complexity} onChange={e => setComplexity(e.target.value)} placeholder="moderate" /></div>
        </div>

        <div style={{ ...fieldWrap, marginTop: 12 }}>
          <span style={fieldCaption}>Prompt (optional)</span>
          <textarea style={{ ...input, minHeight: 60, resize: 'vertical' }} value={prompt} onChange={e => setPrompt(e.target.value)}
                    placeholder="driving melodic bassline with variation" />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={button}>
            {referenceFile ? `✓ ${referenceFile.name}` : 'Reference audio (optional)'}
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => setReferenceFile(e.target.files?.[0] ?? null)} />
          </label>
          {selectedProvider?.supports.melody_conditioning && (
            <label style={button}>
              {melodyFile ? `✓ ${melodyFile.name}` : 'Melody audio (optional)'}
              <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => setMelodyFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        <button
          disabled={!canGenerate}
          onClick={handleGenerate}
          style={{ marginTop: 16, padding: '10px 20px', border: 'none', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
            background: canGenerate ? 'var(--accent)' : 'var(--surface2)', color: canGenerate ? '#fff' : 'var(--text-muted)',
            cursor: canGenerate ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700 }}
        >
          <Sparkles size={14} /> Generate
        </button>
        {!sidecarReady && <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>Start the Song Generation sidecar above first.</p>}
      </section>

      {inFlight.length > 0 && (
        <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={label}>Generating</div>
          {inFlight.map(({ id, job }) => (
            <div key={id} style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>
                  <Loader2 size={12} style={{ verticalAlign: 'middle', marginRight: 6, animation: 'spin 1s linear infinite' }} />
                  {instrument} — {job.status}
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
        <div style={label}>{instrument} ideas</div>
        {filteredAssets.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>No {instrument.toLowerCase()} ideas yet — generate one above.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginTop: 10 }}>
            {filteredAssets.map(asset => (
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

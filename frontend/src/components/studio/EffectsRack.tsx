import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveVoiceMonitor, makeLiveGraph, type ActiveEffect } from './LiveVoiceMonitor'

interface EffectParam {
  name: string; label: string; type: 'range' | 'select'
  min?: number; max?: number; step?: number
  options?: { value: string; label: string }[]
  default: number | string
}
interface EffectDef { type: string; label: string; icon: string; params: EffectParam[] }

const EFFECT_DEFS: EffectDef[] = [
  {
    type: 'reverb', label: 'Reverb', icon: '🌊',
    params: [
      { name: 'room_size', label: 'Room Size', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { name: 'damping',   label: 'Damping',   type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { name: 'wet_level', label: 'Wet',        type: 'range', min: 0, max: 1, step: 0.01, default: 0.33 },
      { name: 'dry_level', label: 'Dry',        type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
    ],
  },
  {
    type: 'compressor', label: 'Compressor', icon: '📊',
    params: [
      { name: 'threshold_db', label: 'Threshold dB', type: 'range', min: -60, max: 0, step: 0.5, default: -20 },
      { name: 'ratio',        label: 'Ratio',         type: 'range', min: 1, max: 20, step: 0.1, default: 4 },
      { name: 'attack_ms',   label: 'Attack ms',     type: 'range', min: 0, max: 200, step: 1, default: 20 },
      { name: 'release_ms',  label: 'Release ms',    type: 'range', min: 10, max: 1000, step: 10, default: 150 },
    ],
  },
  {
    type: 'chorus', label: 'Chorus', icon: '🎭',
    params: [
      { name: 'rate_hz', label: 'Rate Hz', type: 'range', min: 0.1, max: 10, step: 0.1, default: 1.0 },
      { name: 'depth',   label: 'Depth',   type: 'range', min: 0, max: 1, step: 0.01, default: 0.25 },
      { name: 'mix',     label: 'Mix',     type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  {
    type: 'delay', label: 'Delay', icon: '🔁',
    params: [
      { name: 'delay_seconds', label: 'Delay s',  type: 'range', min: 0, max: 2, step: 0.01, default: 0.25 },
      { name: 'feedback',      label: 'Feedback', type: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
      { name: 'mix',           label: 'Mix',      type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
    ],
  },
  {
    type: 'distortion', label: 'Distortion', icon: '⚡',
    params: [
      { name: 'drive_db', label: 'Drive dB', type: 'range', min: 0, max: 40, step: 0.5, default: 15 },
      { name: 'tone',     label: 'Tone',     type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  {
    type: 'eq', label: 'EQ (3-band)', icon: '🎚',
    params: [
      { name: 'low_gain_db',  label: 'Low dB',  type: 'range', min: -15, max: 15, step: 0.5, default: 0 },
      { name: 'mid_gain_db',  label: 'Mid dB',  type: 'range', min: -15, max: 15, step: 0.5, default: 0 },
      { name: 'high_gain_db', label: 'High dB', type: 'range', min: -15, max: 15, step: 0.5, default: 0 },
    ],
  },
  { type: "highpass", label: "High-pass", icon: "↗", params: [{ name: "cutoff_frequency_hz", label: "Cutoff Hz", type: "range", min: 20, max: 1000, step: 5, default: 80 }] },
  { type: "lowpass", label: "Low-pass", icon: "↘", params: [{ name: "cutoff_frequency_hz", label: "Cutoff Hz", type: "range", min: 500, max: 16000, step: 50, default: 6500 }] },
  { type: "pitch_shift", label: "Pitch Shift", icon: "↕", params: [{ name: "semitones", label: "Semitones", type: "range", min: -12, max: 12, step: 0.5, default: 0 }] },
  { type: "bitcrush", label: "Bitcrush", icon: "▦", params: [{ name: "bit_depth", label: "Bit Depth", type: "range", min: 2, max: 16, step: 1, default: 8 }] },
  { type: "resample", label: "Digital Resample", icon: "◫", params: [{ name: "target_sample_rate", label: "Sample Rate", type: "range", min: 2000, max: 24000, step: 1000, default: 8000 }] },
  { type: "noise_gate", label: "Noise Gate", icon: "⟂", params: [{ name: "threshold_db", label: "Threshold dB", type: "range", min: -80, max: -10, step: 1, default: -45 }, { name: "ratio", label: "Ratio", type: "range", min: 1, max: 20, step: 1, default: 8 }, { name: "attack_ms", label: "Attack ms", type: "range", min: 0.1, max: 50, step: 0.1, default: 2 }, { name: "release_ms", label: "Release ms", type: "range", min: 10, max: 500, step: 10, default: 120 }] },
  { type: "limiter", label: "Limiter", icon: "▰", params: [{ name: "threshold_db", label: "Threshold dB", type: "range", min: -24, max: 0, step: 0.5, default: -2 }, { name: "release_ms", label: "Release ms", type: "range", min: 10, max: 500, step: 10, default: 100 }] },
  { type: "gain", label: "Gain", icon: "＋", params: [{ name: "gain_db", label: "Gain dB", type: "range", min: -24, max: 24, step: 0.5, default: 0 }] },
  { type: "peak", label: "Presence EQ", icon: "⌁", params: [{ name: "cutoff_frequency_hz", label: "Frequency Hz", type: "range", min: 100, max: 10000, step: 50, default: 3000 }, { name: "gain_db", label: "Gain dB", type: "range", min: -18, max: 18, step: 0.5, default: 0 }, { name: "q", label: "Q", type: "range", min: 0.1, max: 4, step: 0.1, default: 0.8 }] },
  { type: "high_shelf", label: "Air EQ", icon: "⌇", params: [{ name: "cutoff_frequency_hz", label: "Frequency Hz", type: "range", min: 1000, max: 16000, step: 100, default: 7000 }, { name: "gain_db", label: "Gain dB", type: "range", min: -18, max: 18, step: 0.5, default: 0 }] },
]

const VOICE_PRESETS: { name: string; description: string; chain: ActiveEffect[] }[] = [
  { name: "Broadcast Polish", description: "Clear, warm podcast narration", chain: [{ type: "highpass", params: { cutoff_frequency_hz: 75 } }, { type: "eq", params: { low_gain_db: -1, mid_gain_db: 2, high_gain_db: 3 } }, { type: "compressor", params: { threshold_db: -20, ratio: 3, attack_ms: 12, release_ms: 140 } }, { type: "limiter", params: { threshold_db: -2, release_ms: 100 } }] },
  { name: "Tiny Toon", description: "Bright, energetic cartoon sidekick", chain: [{ type: "pitch_shift", params: { semitones: 5 } }, { type: "highpass", params: { cutoff_frequency_hz: 180 } }, { type: "peak", params: { cutoff_frequency_hz: 3200, gain_db: 5, q: 0.9 } }, { type: "compressor", params: { threshold_db: -24, ratio: 5, attack_ms: 8, release_ms: 100 } }, { type: "limiter", params: { threshold_db: -2, release_ms: 80 } }] },
  { name: "Gentle Giant", description: "Large, warm, grounded character", chain: [{ type: "pitch_shift", params: { semitones: -5 } }, { type: "lowpass", params: { cutoff_frequency_hz: 6500 } }, { type: "eq", params: { low_gain_db: 5, mid_gain_db: -1, high_gain_db: -2 } }, { type: "compressor", params: { threshold_db: -22, ratio: 4, attack_ms: 18, release_ms: 180 } }, { type: "limiter", params: { threshold_db: -2, release_ms: 120 } }] },
  { name: "Robot Radio", description: "Crunchy comms and machine texture", chain: [{ type: "highpass", params: { cutoff_frequency_hz: 350 } }, { type: "lowpass", params: { cutoff_frequency_hz: 3400 } }, { type: "resample", params: { target_sample_rate: 8000 } }, { type: "bitcrush", params: { bit_depth: 7 } }, { type: "distortion", params: { drive_db: 8 } }, { type: "limiter", params: { threshold_db: -3, release_ms: 80 } }] },
  { name: "Cosmic Oracle", description: "Ethereal narrator with a wide halo", chain: [{ type: "pitch_shift", params: { semitones: -2 } }, { type: "chorus", params: { rate_hz: 0.35, depth: 0.45, mix: 0.35 } }, { type: "reverb", params: { room_size: 0.75, damping: 0.35, wet_level: 0.3, dry_level: 0.6 } }, { type: "delay", params: { delay_seconds: 0.28, feedback: 0.18, mix: 0.15 } }, { type: "limiter", params: { threshold_db: -2, release_ms: 120 } }] },
  { name: "Villain PA", description: "Dark, compressed public-address menace", chain: [{ type: "pitch_shift", params: { semitones: -3 } }, { type: "highpass", params: { cutoff_frequency_hz: 120 } }, { type: "lowpass", params: { cutoff_frequency_hz: 5200 } }, { type: "distortion", params: { drive_db: 5 } }, { type: "compressor", params: { threshold_db: -28, ratio: 7, attack_ms: 5, release_ms: 100 } }, { type: "limiter", params: { threshold_db: -3, release_ms: 80 } }] },
]

const EFFECT_DESCRIPTIONS: Record<string, string> = {
  reverb: "Adds a virtual room around the voice. Keep wet low for dialogue.", compressor: "Evans out loud and quiet words for a steady, close-mic performance.", chorus: "Creates a doubled, moving voice; useful for aliens and dreamy characters.", delay: "Repeats the voice after a short time; use low mix for space, not clutter.", distortion: "Adds harmonic grit and edge for robots, radios, and villains.", eq: "Shapes lows, speech presence, and air. Changes apply to the rendered file.", highpass: "Removes rumble and low-end boom below the cutoff.", lowpass: "Rolls off brightness for large, distant, or telephone-like characters.", pitch_shift: "Changes perceived character size without changing length. Render-only in live monitor.", bitcrush: "Reduces digital resolution for crunchy retro machine voices. Render-only live.", resample: "Downsamples then restores audio for radio and digital artifacts. Render-only live.", noise_gate: "Closes down low-level room noise between words. Render-only live.", limiter: "Catches peaks at the end of a chain so character effects do not clip.", gain: "Raises or lowers output level before later modules.", peak: "Boosts or cuts one focused frequency band, usually speech presence.", high_shelf: "Adds or removes high-frequency air and sparkle above the selected frequency.",
}

function makeDefault(def: EffectDef): ActiveEffect {
  const params: Record<string, number | string> = {}
  def.params.forEach(p => { params[p.name] = p.default })
  return { type: def.type, params }
}

interface EffectsRackProps {
  sidecarReady: boolean
  externalFile?: Blob | null
  onExternalFileConsumed?: () => void
}

export function EffectsRack({ sidecarReady, externalFile, onExternalFileConsumed }: EffectsRackProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [chain, setChain] = useState<ActiveEffect[]>([])
  const [processing, setProcessing] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const previewAudioRef = useRef<HTMLAudioElement>(null)
  const previewCtxRef = useRef<AudioContext | null>(null)
  const previewSourceRef = useRef<MediaElementAudioSourceNode | null>(null)

  const rebuildPreviewGraph = useCallback(() => {
    const ctx = previewCtxRef.current
    const source = previewSourceRef.current
    if (!ctx || !source) return
    try { source.disconnect() } catch { /* no active preview connection */ }
    const { tail } = makeLiveGraph(ctx, source, chain)
    tail.connect(ctx.destination)
  }, [chain])

  useEffect(() => {
    if (!externalFile) return
    // Notifies the parent (onExternalFileConsumed) once the file's adopted, so
    // this has to run as an effect, not during render — calling a parent
    // callback synchronously during render risks "setState while rendering a
    // different component" if the parent clears externalFile in response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFile(new File([externalFile], 'recording.wav', { type: 'audio/wav' }))
    setResultUrl(null)
    onExternalFileConsumed?.()
  }, [externalFile, onExternalFileConsumed])

  useEffect(() => {
    // Creating/revoking a blob URL is real resource-lifecycle synchronization,
    // not derived state — doing this during render would leak a URL every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => { rebuildPreviewGraph() }, [chain, rebuildPreviewGraph])
  useEffect(() => () => {
    previewAudioRef.current?.pause()
    try { previewSourceRef.current?.disconnect() } catch { /* already disconnected */ }
    void previewCtxRef.current?.close()
  }, [])

  function addEffect(def: EffectDef) {
    setChain(c => [...c, makeDefault(def)])
  }

  function removeEffect(i: number) {
    setChain(c => c.filter((_, idx) => idx !== i))
  }

  function updateParam(i: number, name: string, value: number | string) {
    setChain(c => c.map((e, idx) => idx === i ? { ...e, params: { ...e.params, [name]: value } } : e))
  }

  async function togglePreview() {
    const audio = previewAudioRef.current
    if (!audio || !file) return
    if (!previewCtxRef.current) {
      const ctx = new AudioContext()
      previewCtxRef.current = ctx
      previewSourceRef.current = ctx.createMediaElementSource(audio)
      rebuildPreviewGraph()
    }
    const ctx = previewCtxRef.current
    if (audio.paused) {
      await ctx?.resume()
      await audio.play()
      setPreviewPlaying(true)
    } else {
      audio.pause()
      setPreviewPlaying(false)
    }
  }

  async function applyChain() {
    if (!file || chain.length === 0) return
    setProcessing(true); setError(''); setResultUrl(null)
    const form = new FormData()
    form.append('audio', file)
    form.append('effects', JSON.stringify(chain.map(e => ({ type: e.type, params: e.params }))))
    try {
      const blob = await fetch('/api/studio/effects/chain', { method: 'POST', body: form }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      const url = URL.createObjectURL(blob)
      setResultUrl(url)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setProcessing(false) }
  }

  const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <input ref={fileRef} type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.m4a" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setResultUrl(null) } }} />

      <div>
        <span style={{ ...label, display: 'block', marginBottom: 8 }}>Audio File</span>
        <div
          onClick={() => fileRef.current?.click()}
          style={{ border: `1px dashed ${file ? 'var(--accent)' : 'var(--border)'}`, background: file ? 'rgba(124,110,247,0.06)' : 'transparent', borderRadius: 8, padding: '14px 18px', color: file ? 'var(--text)' : 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'center' }}
        >
          {file ? `🎵 ${file.name}` : 'Click to pick an audio file'}
        </div>
      </div>

      <div>
        <span style={{ ...label, display: 'block', marginBottom: 8 }}>Voice character presets</span>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>Start with a complete Pedalboard chain, then fine-tune any module below.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 18 }}>
          {VOICE_PRESETS.map(preset => (
            <button key={preset.name} onClick={() => { setChain(preset.chain.map(effect => ({ ...effect, params: { ...effect.params } }))); setResultUrl(null) }} style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
              <strong style={{ display: 'block', fontSize: 12, marginBottom: 3 }}>{preset.name}</strong><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{preset.description}</span>
            </button>
          ))}
        </div>
        <span style={{ ...label, display: 'block', marginBottom: 8 }}>Add individual effects</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EFFECT_DEFS.map(def => (
            <button key={def.type} onClick={() => addEffect(def)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}>
              {def.icon} {def.label}
            </button>
          ))}
        </div>
      </div>

      <LiveVoiceMonitor chain={chain} />

      {chain.length > 0 && (
        <div>
          <span style={{ ...label, display: 'block', marginBottom: 8 }}>Effect Chain</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chain.map((effect, i) => {
              const def = EFFECT_DEFS.find(d => d.type === effect.type)
              if (!def) return <div key={i} style={{ background: 'rgba(239,68,68,.08)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger)', fontSize: 12 }}>Unsupported effect “{effect.type}”. Remove it and choose a supported module.</div>
              return (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div><span style={{ fontWeight: 600, fontSize: 13 }}>{def.icon} {def.label}</span><p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35 }}>{EFFECT_DESCRIPTIONS[def.type]}</p></div>
                    <button onClick={() => removeEffect(i)} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                    {def.params.map(p => (
                      <div key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'monospace' }}>{effect.params[p.name]}</span>
                        </div>
                        {p.type === 'range' && (
                          <input type="range" min={p.min} max={p.max} step={p.step} value={Number(effect.params[p.name])}
                            onChange={e => updateParam(i, p.name, Number(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--accent)' }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {previewUrl && (
        <section style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={label}>Live WAV audition</div>
          <p style={{ margin: '6px 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>Play the selected take through the current chain. Slider changes rebuild the audition immediately while playback continues; use headphones if monitoring the mic too.</p>
          <audio ref={previewAudioRef} src={previewUrl} preload="auto" onEnded={() => setPreviewPlaying(false)} style={{ display: 'none' }} />
          <button type="button" onClick={() => void togglePreview()} style={{ padding: '8px 13px', borderRadius: 7, border: '1px solid var(--accent)', background: previewPlaying ? 'rgba(239,68,68,.12)' : 'rgba(124,110,247,.14)', color: previewPlaying ? 'var(--danger)' : 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{previewPlaying ? 'Stop audition' : '▶ Audition current settings'}</button>
        </section>
      )}

      <button
        disabled={!file || chain.length === 0 || processing || !sidecarReady}
        onClick={applyChain}
        style={{ padding: '10px 24px', background: (!file || chain.length === 0 || processing || !sidecarReady) ? 'var(--surface2)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: (!file || chain.length === 0 || processing || !sidecarReady) ? 'not-allowed' : 'pointer', opacity: (!file || chain.length === 0 || processing || !sidecarReady) ? 0.5 : 1, alignSelf: 'flex-start' }}
      >
        {processing ? 'Processing…' : 'Apply Chain'}
      </button>

      {error && <div style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      {resultUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <audio controls src={resultUrl} style={{ flex: 1, height: 32 }} />
          <a href={resultUrl} download="processed.wav">
            <button style={{ fontSize: 12, padding: '6px 14px', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', background: 'transparent', cursor: 'pointer' }}>↓ Download</button>
          </a>
        </div>
      )}

      {!sidecarReady && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          The Audio FX sidecar is not running. Start it from the sidecar panel above.
        </div>
      )}
    </div>
  )
}

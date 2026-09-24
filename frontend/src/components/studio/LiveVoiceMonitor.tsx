import { useEffect, useRef, useState } from 'react'
import { describeMicError } from '../../lib/mic'

// Exported so audioDsp.ts (demo-mode offline rendering) and EffectsRack.tsx share one
// definition instead of each declaring their own copy.
export type ActiveEffect = { type: string; params: Record<string, number | string> }

function dbToGain(value: number) { return 10 ** (value / 20) }
// BaseAudioContext (not AudioContext) so this also works with OfflineAudioContext —
// AudioContext and OfflineAudioContext are siblings, not one a subtype of the other, but
// every method used here (createBuffer, createBiquadFilter, createScriptProcessor, etc.)
// is declared on their shared parent. The demo build's offline effects/pitch-shift
// rendering (frontend/src/lib/demo/audioDsp.ts) depends on this widening.
function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * ((1 - i / length) ** decay)
  }
  return buffer
}

function liveProcessor(ctx: BaseAudioContext, kind: "bitcrush" | "resample" | "noise_gate" | "pitch_shift", amount: number) {
  const node = ctx.createScriptProcessor(1024, 1, 1)
  let held = 0
  let counter = 0
  // Two overlapping, short resampling grains give live pitch shifting without changing speaking pace.
  const grainSize = 2048
  const ring = new Float32Array(16384)
  let write = 0
  const grains = [{ progress: 0, start: -4096 }, { progress: grainSize / 2, start: -4096 - grainSize / 2 }]
  node.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0)
    const output = event.outputBuffer.getChannelData(0)
    const hold = kind === "resample" ? Math.max(1, Math.round(ctx.sampleRate / amount)) : 1
    const levels = kind === "bitcrush" ? Math.max(4, 2 ** Math.round(amount)) : 0
    const threshold = kind === "noise_gate" ? 10 ** (amount / 20) : 0
    const ratio = 2 ** (amount / 12)
    for (let i = 0; i < input.length; i++) {
      let sample = input[i]
      if (kind === "pitch_shift") {
        ring[write % ring.length] = sample
        let mixed = 0
        let weightTotal = 0
        for (const grain of grains) {
          const phase = grain.progress / grainSize
          const read = grain.start + grain.progress * ratio
          const base = Math.floor(read)
          const frac = read - base
          const a = ring[((base % ring.length) + ring.length) % ring.length]
          const b = ring[(((base + 1) % ring.length) + ring.length) % ring.length]
          const weight = Math.sin(Math.PI * phase) ** 2
          mixed += (a + (b - a) * frac) * weight
          weightTotal += weight
          grain.progress++
          if (grain.progress >= grainSize) { grain.progress = 0; grain.start = write - 4096 }
        }
        sample = weightTotal ? mixed / weightTotal : 0
        write++
      }
      if (kind === "noise_gate") sample = Math.abs(sample) < threshold ? 0 : sample
      if (kind === "bitcrush") sample = Math.round(sample * levels) / levels
      if (kind === "resample") { if (counter++ % hold === 0) held = sample; sample = held }
      output[i] = sample
    }
  }
  return node
}

export function makeLiveGraph(ctx: BaseAudioContext, input: AudioNode, chain: ActiveEffect[]) {
  let tail: AudioNode = input
  const renderedOnly: string[] = []
  for (const effect of chain) {
    const p = effect.params
    if (effect.type === 'highpass' || effect.type === 'lowpass') {
      const node = ctx.createBiquadFilter(); node.type = effect.type; node.frequency.value = Number(p.cutoff_frequency_hz); tail.connect(node); tail = node
    } else if (effect.type === 'eq') {
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180; low.gain.value = Number(p.low_gain_db)
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1800; mid.Q.value = 0.9; mid.gain.value = Number(p.mid_gain_db)
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6500; high.gain.value = Number(p.high_gain_db)
      tail.connect(low); low.connect(mid); mid.connect(high); tail = high
    } else if (effect.type === 'peak' || effect.type === 'high_shelf') {
      const node = ctx.createBiquadFilter(); node.type = effect.type === 'peak' ? 'peaking' : 'highshelf'; node.frequency.value = Number(p.cutoff_frequency_hz); node.gain.value = Number(p.gain_db); if (effect.type === 'peak') node.Q.value = Number(p.q); tail.connect(node); tail = node
    } else if (effect.type === 'gain') {
      const node = ctx.createGain(); node.gain.value = dbToGain(Number(p.gain_db)); tail.connect(node); tail = node
    } else if (effect.type === 'compressor' || effect.type === 'limiter') {
      const node = ctx.createDynamicsCompressor(); node.threshold.value = Number(p.threshold_db); node.ratio.value = effect.type === 'limiter' ? 20 : Number(p.ratio); node.attack.value = Number(p.attack_ms ?? 3) / 1000; node.release.value = Number(p.release_ms ?? 100) / 1000; tail.connect(node); tail = node
    } else if (effect.type === 'distortion') {
      const node = ctx.createWaveShaper(); const amount = Math.max(1, Number(p.drive_db)) * 7; const curve = new Float32Array(44100); for (let i = 0; i < curve.length; i++) { const x = i * 2 / curve.length - 1; curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x)) } node.curve = curve; node.oversample = '4x'; tail.connect(node); tail = node
    } else if (effect.type === 'delay') {
      const dry = ctx.createGain(); dry.gain.value = 1 - Number(p.mix); const delay = ctx.createDelay(2); delay.delayTime.value = Number(p.delay_seconds); const feedback = ctx.createGain(); feedback.gain.value = Number(p.feedback); const wet = ctx.createGain(); wet.gain.value = Number(p.mix); const mix = ctx.createGain(); tail.connect(dry); dry.connect(mix); tail.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(mix); tail = mix
    } else if (effect.type === 'reverb') {
      const dry = ctx.createGain(); dry.gain.value = Number(p.dry_level); const convolver = ctx.createConvolver(); convolver.buffer = impulse(ctx, 0.6 + Number(p.room_size) * 2.4, 1 + Number(p.damping) * 3); const wet = ctx.createGain(); wet.gain.value = Number(p.wet_level); const mix = ctx.createGain(); tail.connect(dry); dry.connect(mix); tail.connect(convolver); convolver.connect(wet); wet.connect(mix); tail = mix
    } else if (effect.type === 'chorus') {
      const dry = ctx.createGain(); dry.gain.value = 1 - Number(p.mix); const delay = ctx.createDelay(0.08); delay.delayTime.value = Number(p.centre_delay_ms ?? 8) / 1000; const lfo = ctx.createOscillator(); lfo.frequency.value = Number(p.rate_hz); const depth = ctx.createGain(); depth.gain.value = Number(p.depth) * 0.012; const wet = ctx.createGain(); wet.gain.value = Number(p.mix); const mix = ctx.createGain(); lfo.connect(depth); depth.connect(delay.delayTime); lfo.start(); tail.connect(dry); dry.connect(mix); tail.connect(delay); delay.connect(wet); wet.connect(mix); tail = mix
    } else if (effect.type === "bitcrush" || effect.type === "resample" || effect.type === "noise_gate") {
      const value = effect.type === "bitcrush" ? Number(p.bit_depth) : effect.type === "resample" ? Number(p.target_sample_rate) : Number(p.threshold_db)
      const node = liveProcessor(ctx, effect.type, value); tail.connect(node); tail = node
    } else if (effect.type === "pitch_shift") {
      const node = liveProcessor(ctx, "pitch_shift", Number(p.semitones)); tail.connect(node); tail = node
    }
  }
  return { tail, renderedOnly }
}

export function LiveVoiceMonitor({ chain }: { chain: ActiveEffect[] }) {
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  function stop() {
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null
    ctxRef.current?.close(); ctxRef.current = null
    setActive(false)
  }
  async function start() {
    stop(); setStarting(true); setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      const ctx = new AudioContext(); await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const { tail } = makeLiveGraph(ctx, source, chain)
      tail.connect(ctx.destination)
      streamRef.current = stream; ctxRef.current = ctx; setActive(true)
    } catch (cause: unknown) { setError(describeMicError(cause)) }
    finally { setStarting(false) }
  }
  useEffect(() => () => stop(), [])
  useEffect(() => {
    // Rebuild the Web Audio graph whenever a slider changes so monitoring matches the chain.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain])
  const renderedOnly: string[] = []

  return <section style={{ padding: 14, borderRadius: 10, border: active ? '1px solid var(--accent2)' : '1px solid var(--border)', background: active ? 'rgba(94,234,212,.05)' : 'var(--surface)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div style={{ flex: 1 }}><div style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 700, letterSpacing: '.06em' }}>LIVE MONITOR</div><strong style={{ display: 'block', marginTop: 3, fontSize: 13 }}>Talk through your current character effects</strong></div><button onClick={active ? stop : start} disabled={starting} style={{ padding: '8px 12px', border: 'none', borderRadius: 7, background: active ? 'var(--danger)' : 'var(--accent)', color: '#fff', cursor: starting ? 'wait' : 'pointer', fontWeight: 700, fontSize: 12 }}>{starting ? 'Connecting…' : active ? 'Stop monitor' : 'Start live monitor'}</button></div>
    <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45 }}><strong style={{ color: 'var(--warning)' }}>Use headphones.</strong> Speaker monitoring can create feedback. Filters, EQ, compression, distortion, delay, chorus, reverb, bitcrush, resampling, gating, and pitch shifting update live. Live pitch uses a low-latency granular processor; use <strong>Apply Chain</strong> for the final high-quality Pedalboard WAV.</p>
    {renderedOnly.length > 0 && <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 11 }}>Render-only in this monitor (true pitch/formant shifting needs the RVC render path): {renderedOnly.join(', ')}.</p>}
    {error && <p style={{ margin: '8px 0 0', color: 'var(--danger)', fontSize: 11 }}>{error}</p>}
  </section>
}

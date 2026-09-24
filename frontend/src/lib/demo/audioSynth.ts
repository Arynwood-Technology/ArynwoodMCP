// Procedural oscillator+envelope synthesizer for demo-mode "generation" features
// (Instrument Generator, Jam with AI, Vocal Booth's script-to-voice) — none of these have
// real input audio to process, unlike Effects Rack/Voice Conversion/Stem Separator
// (audioDsp.ts), so there's nothing honest to run real DSP on. This extends the
// `impulse()`-style "procedurally fill a buffer" precedent already in
// LiveVoiceMonitor.tsx, but with real pitched content (a seeded scale-walk melody)
// instead of noise, so the result is genuinely synthesized each time — not one static
// file played back regardless of what was asked for.
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10]
const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11]
const NOTE_SEMITONES: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6,
  g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
}

function parseKey(key?: string): { root: number; minor: boolean } {
  const m = /^([a-g][#b]?)\s*(min|maj)?/i.exec((key ?? '').trim())
  return { root: m ? (NOTE_SEMITONES[m[1].toLowerCase()] ?? 9) : 9, minor: !m || !/maj/i.test(m[2] ?? '') }
}

function hashSeed(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

/** Semitones from A4 -> Hz. */
function freq(semitoneFromA4: number): number {
  return 440 * 2 ** (semitoneFromA4 / 12)
}

export type SynthVoice = 'pad' | 'pluck' | 'bass' | 'perc' | 'lead'

export interface SynthRequest {
  durationSeconds: number
  bpm?: number
  key?: string
  seed: string
  voice: SynthVoice
  /** Denser, speech-cadence steps for TTS instead of a musical 8th-note grid. */
  speechLike?: boolean
}

export async function synthesizeClip({ durationSeconds, bpm, key, seed, voice, speechLike }: SynthRequest): Promise<AudioBuffer> {
  const sampleRate = 44100
  const duration = Math.max(1, Math.min(durationSeconds, 60))
  const ctx = new OfflineAudioContext(2, Math.ceil((duration + 0.4) * sampleRate), sampleRate)

  const { root, minor } = parseKey(key)
  const scale = minor ? SCALE_MINOR : SCALE_MAJOR
  const stepSeconds = speechLike ? 0.12 : 60 / (bpm && bpm > 0 ? bpm : 100) / 2
  const seedN = hashSeed(seed)

  const master = ctx.createGain()
  master.gain.value = 0.25
  master.connect(ctx.destination)

  const steps = Math.floor(duration / stepSeconds)
  for (let i = 0; i < steps; i++) {
    const degree = scale[(seedN + i * 3) % scale.length]
    const shift = voice === 'bass' ? -24 : voice === 'lead' ? 12 : 0
    const jitter = speechLike ? ((seedN >> (i % 16)) % 5) - 2 : 0 // small per-step pitch jitter for a speech-like cadence

    const osc = ctx.createOscillator()
    osc.type = voice === 'bass' ? 'sawtooth' : voice === 'perc' ? 'square' : voice === 'pluck' ? 'triangle' : 'sine'
    osc.frequency.value = freq(root - 9 + degree + shift + jitter)

    const env = ctx.createGain()
    const t0 = i * stepSeconds
    const dur = stepSeconds * 0.9
    env.gain.setValueAtTime(0, t0)
    env.gain.linearRampToValueAtTime(0.8, t0 + 0.01)
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur)

    osc.connect(env)
    env.connect(master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  return ctx.startRendering()
}

/** Picks a synth voice/register from a free-text instrument or band-role description. */
export function voiceForInstrument(instrument: string): SynthVoice {
  const s = instrument.toLowerCase()
  if (s.includes('bass')) return 'bass'
  if (s.includes('drum') || s.includes('percussion')) return 'perc'
  if (s.includes('guitar') || s.includes('piano')) return 'pluck'
  if (s.includes('synth') || s.includes('lead') || s.includes('counter') || s.includes('solo')) return 'lead'
  return 'pad'
}

export function voiceForRole(role: string): SynthVoice {
  const s = role.toLowerCase()
  if (s.includes('bass')) return 'bass'
  if (s.includes('drum')) return 'perc'
  if (s.includes('guitar') || s.includes('keyboard')) return 'pluck'
  if (s.includes('solo') || s.includes('counter')) return 'lead'
  return 'pad'
}

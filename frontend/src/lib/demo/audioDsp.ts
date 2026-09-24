// Real Web Audio processing for demo-mode Effects Rack, Voice Conversion, and Stem
// Separator — reuses makeLiveGraph (frontend/src/components/studio/LiveVoiceMonitor.tsx),
// the same graph EffectsRack.tsx already uses for its live preview, rendered offline via
// OfflineAudioContext instead of live. This is genuinely, honestly functional: real DSP
// run on the visitor's real uploaded/recorded audio, not a faked/canned result.
import { makeLiveGraph, type ActiveEffect } from '../../components/studio/LiveVoiceMonitor'
import { audioBufferToWavBlob } from '../wav'

async function decodeToBuffer(file: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    void ctx.close()
  }
}

function renderChainOffline(decoded: AudioBuffer, chain: ActiveEffect[], extraTailSeconds: number): Promise<AudioBuffer> {
  const total = Math.max(0.1, decoded.duration) + extraTailSeconds
  const offline = new OfflineAudioContext(decoded.numberOfChannels, Math.ceil(total * decoded.sampleRate), decoded.sampleRate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  const { tail } = makeLiveGraph(offline, source, chain)
  tail.connect(offline.destination)
  source.start()
  return offline.startRendering()
}

/** Effects Rack's "Apply Chain" — the real requested effect chain, genuinely rendered. */
export async function renderEffectsChain(file: Blob, chain: ActiveEffect[]): Promise<Blob> {
  const decoded = await decodeToBuffer(file)
  const tailSeconds = chain.some(e => ['reverb', 'delay', 'chorus'].includes(e.type)) ? 2 : 0.2
  const rendered = await renderChainOffline(decoded, chain, tailSeconds)
  return audioBufferToWavBlob(rendered)
}

/** Voice Conversion's pitch control — real pitch-shift via the same granular processor
 *  the live monitor uses. Not full RVC voice-model conversion (see the caption this
 *  pairs with in VoiceConversion.tsx) — but a real, audible transformation of the input. */
export async function renderPitchShift(file: Blob, semitones: number): Promise<Blob> {
  const decoded = await decodeToBuffer(file)
  const chain: ActiveEffect[] = semitones ? [{ type: 'pitch_shift', params: { semitones } }] : []
  const rendered = await renderChainOffline(decoded, chain, 0.1)
  return audioBufferToWavBlob(rendered)
}

// Fixed filter bank per stem name — a real, simple frequency split (not literal ML
// source separation). Genuinely, audibly different per stem, paired with an honest
// caption in StemSeparator.tsx that this isn't Demucs-quality separation.
const STEM_FILTERS: Record<string, ActiveEffect[]> = {
  vocals: [{ type: 'highpass', params: { cutoff_frequency_hz: 300 } }, { type: 'lowpass', params: { cutoff_frequency_hz: 3400 } }],
  bass: [{ type: 'lowpass', params: { cutoff_frequency_hz: 150 } }],
  drums: [{ type: 'highpass', params: { cutoff_frequency_hz: 2500 } }], // crude treble/transient-leaning proxy, not real drum isolation
  other: [{ type: 'highpass', params: { cutoff_frequency_hz: 150 } }, { type: 'lowpass', params: { cutoff_frequency_hz: 2500 } }],
  piano: [{ type: 'highpass', params: { cutoff_frequency_hz: 200 } }, { type: 'lowpass', params: { cutoff_frequency_hz: 4500 } }],
  guitar: [{ type: 'highpass', params: { cutoff_frequency_hz: 250 } }, { type: 'lowpass', params: { cutoff_frequency_hz: 5000 } }],
}
const STEM_NAMES: Record<number, string[]> = {
  2: ['vocals', 'other'],
  4: ['vocals', 'drums', 'bass', 'other'],
  6: ['vocals', 'drums', 'bass', 'piano', 'guitar', 'other'],
}

export async function splitStems(file: Blob, stemCount: number): Promise<Record<string, Blob>> {
  const decoded = await decodeToBuffer(file)
  const names = STEM_NAMES[stemCount] ?? STEM_NAMES[4]
  const out: Record<string, Blob> = {}
  for (const name of names) {
    const rendered = await renderChainOffline(decoded, STEM_FILTERS[name] ?? [], 0.1)
    out[name] = audioBufferToWavBlob(rendered)
  }
  return out
}

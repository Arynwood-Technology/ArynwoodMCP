// Route-handler bodies for Music Studio's job-based endpoints (music generate/jam, stem
// separation, voice conversion, Chatterbox TTS) and the synchronous effects-chain
// endpoint. Kept separate from fetchInterceptor.ts so that file stays thin routing glue —
// same reasoning as chatStore.ts holding chat logic instead of inlining it there.
//
// Functions here take plain parameters (FormData, URLSearchParams, id strings) rather
// than fetchInterceptor.ts's DemoReq/Res wrapper types, and return plain object literals
// structurally compatible with its Res union — avoids a circular import between the two
// files without needing a third shared-types module for two small interfaces.
import { mintJobId, startJob, pollJob } from './jobSim'
import { registerDemoAudio, getDemoAudioBlob } from './audioAssets'
import { addMusicAsset, listMusicAssets, renameAsset, setFavorite, deleteAsset, cloneForRegenerate } from './musicAssetStore'
import { synthesizeClip, voiceForInstrument, voiceForRole } from './audioSynth'
import { renderEffectsChain, renderPitchShift, splitStems } from './audioDsp'
import { audioBufferToWavBlob } from '../wav'
import type { ActiveEffect } from '../../components/studio/LiveVoiceMonitor'

function formNum(form: FormData, key: string): number | undefined {
  const v = form.get(key)
  return v ? Number(v) : undefined
}
function formStr(form: FormData, key: string): string | undefined {
  const v = form.get(key)
  return typeof v === 'string' && v ? v : undefined
}

// ---- Music Lab: generate / jam (backend/routers/music.py) ----

export function startMusicGenerate(form: FormData) {
  const instrument = formStr(form, 'instrument') ?? 'Instrument'
  const provider = formStr(form, 'provider') ?? 'acestep'
  const durationSeconds = formNum(form, 'duration_seconds') ?? 15
  const bpm = formNum(form, 'bpm')
  const key = formStr(form, 'key')
  const genre = formStr(form, 'genre')
  const style = formStr(form, 'style')
  const mood = formStr(form, 'mood')
  const prompt = formStr(form, 'prompt')
  const id = mintJobId('music')
  startJob(id, 4000, async jobId => {
    const buffer = await synthesizeClip({
      durationSeconds, bpm, key,
      seed: [instrument, genre, style, mood, prompt].filter(Boolean).join('|'),
      voice: voiceForInstrument(instrument),
    })
    registerDemoAudio(jobId, audioBufferToWavBlob(buffer))
    addMusicAsset({
      id: jobId, kind: 'generated', provider, instrument, prompt: prompt ?? null,
      label: `${instrument} Idea`, duration_seconds: durationSeconds, bpm: bpm ?? null, musical_key: key ?? null,
    })
  })
  return { body: { job_id: id } }
}

export function startMusicJam(form: FormData) {
  const role = formStr(form, 'role') ?? 'Accompaniment'
  const provider = formStr(form, 'provider') ?? 'musicgen'
  const durationSeconds = formNum(form, 'duration_seconds') ?? 15
  const bpm = formNum(form, 'bpm')
  const key = formStr(form, 'key')
  const style = formStr(form, 'style')
  const inputAudio = form.get('input_audio') as File | null
  let sourceAssetId = formStr(form, 'input_asset_id')

  // The real backend creates/reuses a source asset for the input too — mint one if a raw
  // file was uploaded so JamWithAI's input-preview `<audio>` has a real asset to point at.
  if (inputAudio && !sourceAssetId) {
    sourceAssetId = mintJobId('input')
    registerDemoAudio(sourceAssetId, inputAudio)
    addMusicAsset({ id: sourceAssetId, kind: 'recording', label: 'Jam input' })
  }

  const id = mintJobId('jam')
  startJob(id, 4000, async jobId => {
    const buffer = await synthesizeClip({ durationSeconds, bpm, key, seed: [role, style].filter(Boolean).join('|'), voice: voiceForRole(role) })
    registerDemoAudio(jobId, audioBufferToWavBlob(buffer))
    addMusicAsset({
      id: jobId, kind: 'jam_response', provider, source_asset_id: sourceAssetId ?? null, instrument: role,
      label: `${role} response`, duration_seconds: durationSeconds, bpm: bpm ?? null, musical_key: key ?? null,
    })
  })
  return { body: { job_id: id, source_asset_id: sourceAssetId ?? id } }
}

export function pollMusicJob(id: string) {
  const j = pollJob(id)
  if (!j) return { status: 404, body: { detail: 'Unknown job' } }
  return { body: { status: j.phase, progress: j.progress, result_asset_id: j.phase === 'done' ? id : null, error: j.error ?? null } }
}

export function regenerateMusicAssetRoute(id: string) {
  const newId = mintJobId('regen')
  const seed = cloneForRegenerate(id, newId)
  if (!seed) return { status: 404, body: { detail: 'Unknown asset' } }
  startJob(newId, 4000, async jobId => {
    const buffer = await synthesizeClip({
      durationSeconds: seed.duration_seconds ?? 15, bpm: seed.bpm ?? undefined, key: seed.musical_key ?? undefined,
      seed: `${seed.label}-regen-${jobId}`, voice: voiceForInstrument(seed.instrument ?? seed.label),
    })
    registerDemoAudio(jobId, audioBufferToWavBlob(buffer))
    addMusicAsset(seed)
  })
  return { body: { job_id: newId } }
}

export function listMusicAssetsRoute(search: URLSearchParams) {
  return { body: listMusicAssets({ kind: search.get('kind') ?? undefined, instrument: search.get('instrument') ?? undefined }) }
}

export function patchMusicAssetRoute(id: string, json: unknown) {
  const body = (json ?? {}) as { label?: string; favorite?: boolean }
  const asset = typeof body.label === 'string' ? renameAsset(id, body.label)
    : typeof body.favorite === 'boolean' ? setFavorite(id, body.favorite)
    : undefined
  return asset ? { body: asset } : { status: 404, body: { detail: 'Unknown asset' } }
}

export function deleteMusicAssetRoute(id: string) {
  return { body: deleteAsset(id) }
}

/** Backs GET /music/assets/:id/audio — needed for DownloadButton's fetch(apiUrl(url))
 *  path (MusicAssetCard.tsx), which goes through the normal interceptor routing rather
 *  than the audioAssets.ts blob-URL registry that <audio src> itself uses. */
export function getMusicAssetAudio(id: string) {
  const blob = getDemoAudioBlob(id)
  return blob ? { blob, contentType: 'audio/wav', filename: `${id}.wav` } : { status: 404, body: { detail: 'Audio file not found' } }
}

// ---- Studio: stem separation / voice conversion / effects (backend/routers/studio.py) ----

const stemNamesByJob = new Map<string, string[]>()

export function startStemSeparation(form: FormData) {
  const audio = form.get('audio') as File | null
  const stemCount = formNum(form, 'stems') ?? 4
  if (!audio) return { status: 400, body: { detail: 'No audio file' } }
  const id = mintJobId('stems')
  startJob(id, 3000, async jobId => {
    const blobs = await splitStems(audio, stemCount)
    for (const [name, blob] of Object.entries(blobs)) registerDemoAudio(`${jobId}/${name}`, blob)
    stemNamesByJob.set(jobId, Object.keys(blobs))
  })
  return { body: { job_id: id } }
}

export function pollStemJob(id: string) {
  const j = pollJob(id)
  if (!j) return { status: 404, body: { detail: 'Unknown job' } }
  const status = j.phase === 'done' ? 'completed' : j.phase === 'error' ? 'failed' : 'running'
  const names = stemNamesByJob.get(id) ?? []
  return { body: { status, progress: j.progress, stems: status === 'completed' ? Object.fromEntries(names.map(n => [n, `${id}/${n}.wav`])) : undefined, error: j.error } }
}

export function getStemAudio(jobId: string, name: string) {
  const blob = getDemoAudioBlob(`${jobId}/${name}`)
  return blob ? { blob, contentType: 'audio/wav', filename: `${name}.wav` } : { status: 404, body: { detail: 'Unknown stem' } }
}

export function startVoiceConvert(form: FormData) {
  const audio = form.get('audio') as File | null
  const pitchShift = formNum(form, 'pitch_shift') ?? 0
  if (!audio) return { status: 400, body: { detail: 'No audio file' } }
  const id = mintJobId('voice')
  startJob(id, 2400, async jobId => {
    registerDemoAudio(jobId, await renderPitchShift(audio, pitchShift))
  })
  return { body: { job_id: id } }
}

export function pollVoiceConvertJob(id: string) {
  const j = pollJob(id)
  if (!j) return { status: 404, body: { detail: 'Unknown job' } }
  const status = j.phase === 'done' ? 'completed' : j.phase === 'error' ? 'failed' : 'running'
  return { body: { status, progress: j.progress, error: j.error } }
}

export function getVoiceConvertResult(jobId: string) {
  const blob = getDemoAudioBlob(jobId)
  return blob ? { blob, contentType: 'audio/wav', filename: 'converted.wav' } : { status: 404, body: { detail: 'Not ready' } }
}

export async function applyEffectsChain(form: FormData) {
  const audio = form.get('audio') as File | null
  if (!audio) return { status: 400, body: { detail: 'No audio file' } }
  let chain: ActiveEffect[]
  try { chain = JSON.parse(String(form.get('effects') ?? '[]')) as ActiveEffect[] }
  catch { return { status: 400, body: { detail: 'Invalid effects JSON' } } }
  try {
    const blob = await renderEffectsChain(audio, chain)
    return { blob, contentType: 'audio/wav', filename: 'processed.wav' }
  } catch (e) {
    return { status: 500, body: { detail: e instanceof Error ? e.message : 'Demo effects render failed' } }
  }
}

// ---- Vocal Booth script-to-voice (backend/routers/tools.py's generic job registry) ----

export function startChatterboxJob(form: FormData) {
  const text = formStr(form, 'text') ?? ''
  const exaggeration = formNum(form, 'exaggeration') ?? 0.45
  if (!text.trim()) return { status: 400, body: { detail: 'No script text' } }
  const wordCount = text.trim().split(/\s+/).length
  const durationSeconds = Math.max(2, wordCount / 2.5) // ~150wpm
  const id = mintJobId('chatterbox')
  startJob(id, 3500, async jobId => {
    const buffer = await synthesizeClip({ durationSeconds, seed: text.slice(0, 80) + exaggeration, voice: 'pad', speechLike: true })
    registerDemoAudio(jobId, audioBufferToWavBlob(buffer))
  })
  return { body: { job_id: id } }
}

export function pollChatterboxJob(id: string) {
  const j = pollJob(id)
  if (!j) return { status: 404, body: { detail: 'Unknown job' } }
  return { body: { status: j.phase === 'done' ? 'done' : j.phase === 'error' ? 'error' : 'running', error: j.error } }
}

export function getChatterboxFile(jobId: string) {
  const blob = getDemoAudioBlob(jobId)
  return blob ? { blob, contentType: 'audio/wav', filename: 'chatterbox.wav' } : { status: 404, body: { detail: 'Not ready' } }
}

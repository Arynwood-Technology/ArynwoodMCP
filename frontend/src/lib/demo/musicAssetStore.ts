// In-memory MusicAsset CRUD store — mirrors chatStore.ts's pattern (module-level mutable
// state shared between fetchInterceptor.ts's routes and the code that creates results,
// here musicJobs.ts). Session-only, nothing persists across a page reload.
import type { MusicAsset } from '../api'

const assets: MusicAsset[] = []

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export interface NewMusicAsset {
  id: string
  kind: MusicAsset['kind']
  provider?: string | null
  source_asset_id?: string | null
  label: string
  instrument?: string | null
  prompt?: string | null
  duration_seconds?: number | null
  bpm?: number | null
  musical_key?: string | null
}

export function addMusicAsset(a: NewMusicAsset): MusicAsset {
  const asset: MusicAsset = {
    id: a.id,
    kind: a.kind,
    provider: a.provider ?? null,
    source_asset_id: a.source_asset_id ?? null,
    label: a.label,
    instrument: a.instrument ?? null,
    prompt: a.prompt ?? null,
    params_json: JSON.stringify({ instrument: a.instrument, prompt: a.prompt, duration_seconds: a.duration_seconds, bpm: a.bpm, key: a.musical_key }),
    file_path: null, // demo assets live only as blob: URLs (see audioAssets.ts), never a real path
    duration_seconds: a.duration_seconds ?? null,
    bpm: a.bpm ?? null,
    musical_key: a.musical_key ?? null,
    favorite: 0,
    project_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  assets.push(asset)
  return asset
}

export function listMusicAssets(filter?: { kind?: string; instrument?: string }): MusicAsset[] {
  return assets
    .filter(a => !filter?.kind || a.kind === filter.kind)
    .filter(a => !filter?.instrument || a.instrument === filter.instrument)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getMusicAsset(id: string): MusicAsset | undefined {
  return assets.find(a => a.id === id)
}

export function renameAsset(id: string, label: string): MusicAsset | undefined {
  const a = getMusicAsset(id)
  if (a) { a.label = label; a.updated_at = nowIso() }
  return a
}

export function setFavorite(id: string, favorite: boolean): MusicAsset | undefined {
  const a = getMusicAsset(id)
  if (a) { a.favorite = favorite ? 1 : 0; a.updated_at = nowIso() }
  return a
}

export function deleteAsset(id: string): { deleted: string } {
  const idx = assets.findIndex(a => a.id === id)
  if (idx !== -1) assets.splice(idx, 1)
  return { deleted: id }
}

/** Used by a regenerate call — a fresh id/timestamps, same descriptive fields. */
export function cloneForRegenerate(id: string, newId: string): NewMusicAsset | undefined {
  const a = getMusicAsset(id)
  if (!a) return undefined
  return {
    id: newId, kind: a.kind, provider: a.provider, label: a.label, instrument: a.instrument,
    prompt: a.prompt, duration_seconds: a.duration_seconds, bpm: a.bpm, musical_key: a.musical_key,
  }
}

import { useEffect, useRef, useState } from 'react'
import { Play, Square, Download, Pencil, Star, RefreshCw, Trash2, Check, X } from 'lucide-react'
import { renameMusicAsset, favoriteMusicAsset, deleteMusicAsset, regenerateMusicAsset } from '../../lib/api'
import type { MusicAsset } from '../../lib/api'
import { computePeaks, drawWaveform } from '../../lib/waveform'

interface MusicAssetCardProps {
  asset: MusicAsset
  onChanged: () => void
  onRegenerated?: (jobId: string) => void
  supportsExtend?: boolean
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 5, display: 'flex', alignItems: 'center', borderRadius: 5 }
const disabledBtn: React.CSSProperties = { ...iconBtn, opacity: 0.4, cursor: 'not-allowed', fontSize: 11 }

export function MusicAssetCard({ asset, onChanged, onRegenerated, supportsExtend }: MusicAssetCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(asset.label)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const audioUrl = `/api/music/assets/${asset.id}/audio`

  // Waveform thumbnail — decodes the asset once on mount and draws via the
  // shared lib/waveform.ts helpers (peak-cache + windowed draw), the same
  // module TimelineEditor.tsx uses, rather than a one-off canvas routine.
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const res = await fetch(audioUrl)
        if (!res.ok) return
        const arrayBuffer = await res.arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        await ctx.close()
        if (cancelled) return
        const peaks = computePeaks(decoded, 300)
        drawWaveform(canvas, peaks, { startFrac: 0, endFrac: 1, color: '#7c6ef7' })
      } catch { /* thumbnail is best-effort — a failed decode just leaves a blank canvas */ }
    }
    void draw()
    return () => { cancelled = true }
  }, [asset.id, audioUrl])

  function togglePlay() {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); el.currentTime = 0 } else { void el.play() }
  }

  async function saveLabel() {
    if (!labelDraft.trim() || labelDraft === asset.label) { setLabelDraft(asset.label); setEditing(false); return }
    setBusy(true)
    try { await renameMusicAsset(asset.id, labelDraft.trim()); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Rename failed') }
    finally { setBusy(false); setEditing(false) }
  }

  async function toggleFavorite() {
    setBusy(true)
    try { await favoriteMusicAsset(asset.id, !asset.favorite); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update favorite') }
    finally { setBusy(false) }
  }

  async function handleRegenerate() {
    setBusy(true); setError('')
    try { const { job_id } = await regenerateMusicAsset(asset.id); onRegenerated?.(job_id) }
    catch (e) { setError(e instanceof Error ? e.message : 'Regenerate failed') }
    finally { setBusy(false) }
  }

  async function handleDelete() {
    setBusy(true)
    try { await deleteMusicAsset(asset.id); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); setBusy(false) }
  }

  return (
    <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {editing ? (
          <>
            <input
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              style={{ flex: 1, fontSize: 13, padding: '4px 6px' }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') void saveLabel(); if (e.key === 'Escape') { setLabelDraft(asset.label); setEditing(false) } }}
            />
            <button style={iconBtn} onClick={saveLabel} title="Save"><Check size={14} /></button>
            <button style={iconBtn} onClick={() => { setLabelDraft(asset.label); setEditing(false) }} title="Cancel"><X size={14} /></button>
          </>
        ) : (
          <>
            <strong style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.label}</strong>
            <button style={iconBtn} onClick={() => setEditing(true)} title="Rename"><Pencil size={13} /></button>
            <button style={{ ...iconBtn, color: asset.favorite ? '#f59e0b' : 'var(--text-muted)' }} onClick={toggleFavorite} title="Favorite">
              <Star size={13} fill={asset.favorite ? '#f59e0b' : 'none'} />
            </button>
          </>
        )}
      </div>

      <canvas ref={canvasRef} width={280} height={48} style={{ width: '100%', height: 48, borderRadius: 6, background: 'var(--surface)' }} />
      <audio ref={audioRef} src={audioUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} style={{ display: 'none' }} />

      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {asset.instrument && <span>{asset.instrument}</span>}
        {asset.bpm != null && <span>{asset.bpm} BPM</span>}
        {asset.musical_key && <span>{asset.musical_key}</span>}
        {asset.duration_seconds != null && <span>{Math.round(asset.duration_seconds)}s</span>}
        {asset.provider && <span style={{ textTransform: 'capitalize' }}>{asset.provider}</span>}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={iconBtn} onClick={togglePlay} title={playing ? 'Stop' : 'Play'} disabled={busy}>
          {playing ? <Square size={14} /> : <Play size={14} />}
        </button>
        <a href={audioUrl} download={`${asset.label}.wav`}>
          <button style={iconBtn} title="Download"><Download size={14} /></button>
        </a>
        <button style={iconBtn} onClick={handleRegenerate} title="Regenerate" disabled={busy}><RefreshCw size={14} /></button>
        <button style={{ ...iconBtn, color: 'var(--danger)' }} onClick={handleDelete} title="Delete" disabled={busy}><Trash2 size={14} /></button>
        <button style={disabledBtn} title={supportsExtend ? 'Extend — coming soon' : 'Extend — not supported by this provider yet'} disabled>Extend</button>
        <button style={disabledBtn} title="Send to project — arrives with the Music Projects phase" disabled>Send to project</button>
        <button style={disabledBtn} title="Send to DAW — no bridge to MusicStudio's desktop app yet" disabled>Send to DAW</button>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}

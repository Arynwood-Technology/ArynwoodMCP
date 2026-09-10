import { useEffect, useState } from 'react'
import { useJobPoll } from './useJobPoll'
import { getVideoLibrary, type VideoLibraryItem } from '../../lib/api'
import { timestampSlug } from '../../lib/filename'

type Source = { type: 'job'; jobId: string; label: string } | { type: 'upload'; file: File; label: string }
export interface CaptionSegment { start: number; end: number; text: string }

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }
const SEL: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }

// Parses the .srt text Whisper's job already returns back into structured
// {start,end,text} cues — avoids a backend round-trip just to get the
// segment data in a form the Editor's caption track can use directly.
function parseSrt(srt: string): CaptionSegment[] {
  const timeRe = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
  const toSec = (h: string, m: string, s: string, ms: string) => (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000
  const segments: CaptionSegment[] = []
  for (const block of srt.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const timeIdx = lines.findIndex(l => timeRe.test(l))
    if (timeIdx === -1) continue
    const m = lines[timeIdx].match(timeRe)
    if (!m) continue
    const text = lines.slice(timeIdx + 1).join(' ').trim()
    if (!text) continue
    segments.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text })
  }
  return segments
}

export function CaptionsPanel({ onSendToEditor }: { onSendToEditor: (segments: CaptionSegment[]) => void }) {
  const [library, setLibrary] = useState<VideoLibraryItem[]>([])
  const [source, setSource] = useState<Source | null>(null)
  const [model, setModel] = useState('base')
  const [resolving, setResolving] = useState(false)
  const { job, start, reset } = useJobPoll('captions')

  useEffect(() => {
    getVideoLibrary().then(setLibrary).catch(() => {})
  }, [])

  function pickUpload(f: File | null) {
    reset()
    setSource(f ? { type: 'upload', file: f, label: f.name } : null)
  }

  function pickLibrary(item: VideoLibraryItem) {
    reset()
    setSource({ type: 'job', jobId: item.job_id, label: `${item.tool} — ${new Date(item.created_at * 1000).toLocaleTimeString()}` })
  }

  async function run() {
    if (!source) return
    setResolving(true)
    try {
      let file: File | Blob
      if (source.type === 'upload') {
        file = source.file
      } else {
        const r = await fetch(`/api/tools/jobs/${source.jobId}/file`)
        file = await r.blob()
      }
      const form = new FormData()
      form.append('video', file, 'clip.mp4')
      form.append('model', model)
      // Never need the burned-in video render here — captions go to the
      // Editor's own caption track and get burned in at final render time,
      // where they can also be edited first. Skipping burn-in also makes
      // this job finish faster (one fewer ffmpeg pass).
      form.append('burn_in', 'false')
      await start('/api/video/captions/jobs', form)
    } finally {
      setResolving(false)
    }
  }

  function downloadSrt() {
    if (!job.resultText) return
    const blob = new Blob([job.resultText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `captions-${timestampSlug()}.srt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function sendToEditor() {
    if (!job.resultText) return
    const segments = parseSrt(job.resultText)
    if (segments.length === 0) return
    onSendToEditor(segments)
  }

  const running = job.status === 'queued' || job.status === 'running' || resolving

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
      <div>
        <span style={LABEL}>Source Clip</span>
        {library.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {library.map(item => (
              <button
                key={item.job_id} onClick={() => pickLibrary(item)}
                style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: source?.type === 'job' && source.jobId === item.job_id ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: source?.type === 'job' && source.jobId === item.job_id ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                  color: source?.type === 'job' && source.jobId === item.job_id ? 'var(--accent)' : 'var(--text)',
                }}
              >
                {item.tool} ({new Date(item.created_at * 1000).toLocaleTimeString()})
              </button>
            ))}
          </div>
        )}
        <input type="file" accept="video/*,audio/*" style={{ fontSize: 12, color: 'var(--text)' }} onChange={e => pickUpload(e.target.files?.[0] ?? null)} />
        {source && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Selected: {source.label}</p>}
      </div>

      <div>
        <span style={LABEL}>Whisper Model</span>
        <select style={SEL} value={model} onChange={e => setModel(e.target.value)}>
          <option value="tiny">tiny (fastest)</option>
          <option value="base">base</option>
          <option value="small">small</option>
          <option value="medium">medium (most accurate)</option>
        </select>
      </div>

      <button
        onClick={run} disabled={!source || running}
        style={{
          padding: '10px 24px', borderRadius: 8, fontWeight: 600, fontSize: 13, alignSelf: 'flex-start',
          background: !source || running ? 'var(--surface2)' : 'var(--accent)', color: '#fff', border: 'none',
          cursor: !source || running ? 'not-allowed' : 'pointer', opacity: !source || running ? 0.5 : 1,
        }}
      >
        {running ? `${resolving ? 'Preparing' : job.status === 'queued' ? 'Queued' : 'Transcribing'}…` : 'Generate Captions'}
      </button>

      {job.status === 'error' && (
        <div style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>
          <strong>Captioning failed</strong><br />{job.error}
        </div>
      )}

      {job.status === 'done' && job.resultText && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={LABEL}>Transcript (.srt)</span>
          <textarea readOnly value={job.resultText} rows={10} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={sendToEditor}
              style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer' }}
            >
              ➜ Send to Editor
            </button>
            <button onClick={downloadSrt} style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>↓ Download .srt</button>
          </div>
        </div>
      )}
    </div>
  )
}

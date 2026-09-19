import { useEffect, useState } from 'react'
import { useJobPoll } from './useJobPoll'
import { apiUrl, getVideoLibrary, type VideoLibraryItem } from '../../lib/api'
import { DownloadButton } from '../DownloadButton'
import { timestampSlug } from '../../lib/filename'

type FieldSpec =
  | { key: string; label: string; type: 'text'; placeholder?: string }
  | { key: string; label: string; type: 'number'; default: number; step?: number }
  | { key: string; label: string; type: 'file'; accept: string; optional?: boolean }

interface AspectPresets { landscape: [number, number]; vertical: [number, number]; square: [number, number] }

interface EngineSpec {
  id: string
  label: string
  blurb: string
  endpoint: string
  fields: FieldSpec[]
  resultKind: 'video' | 'gif'
  aspects?: AspectPresets  // quick width/height presets, omitted for engines with no size fields
}

const ENGINES: EngineSpec[] = [
  {
    id: 'sadtalker', label: 'SadTalker', blurb: 'Portrait + audio → talking head video. The one tool here confirmed working end-to-end.',
    endpoint: '/api/tools/sadtalker/jobs', resultKind: 'video',
    fields: [
      { key: 'image', label: 'Portrait Image', type: 'file', accept: 'image/*' },
      { key: 'audio', label: 'Audio File', type: 'file', accept: 'audio/*' },
      { key: 'pose_style', label: 'Pose Style', type: 'number', default: 0 },
      { key: 'expression_scale', label: 'Expression Scale', type: 'number', default: 1.0, step: 0.1 },
    ],
  },
  {
    id: 'wan2', label: 'Wan2.1', blurb: 'Text → video (1.3B). 49 frames is the reliable 12GB preview; use 81 frames only after a clean preview.',
    endpoint: '/api/video/wan2/jobs', resultKind: 'video',
    aspects: { landscape: [832, 480], vertical: [480, 832], square: [640, 640] },
    fields: [
      { key: 'prompt', label: 'Prompt', type: 'text', placeholder: 'a corgi surfing a small wave, cinematic' },
      { key: 'negative_prompt', label: 'Negative Prompt', type: 'text' },
      { key: 'num_frames', label: 'Frames (49 = 3s preview, 81 = 5s final)', type: 'number', default: 49 },
      { key: 'fps', label: 'FPS', type: 'number', default: 16 },
      { key: 'width', label: 'Width', type: 'number', default: 832 },
      { key: 'height', label: 'Height', type: 'number', default: 480 },
    ],
  },
  {
    id: 'ltx_video', label: 'LTX-Video', blurb: 'Fast text→video or image→video (2B).',
    endpoint: '/api/tools/ltx_video/jobs', resultKind: 'video',
    aspects: { landscape: [768, 512], vertical: [512, 768], square: [640, 640] },
    fields: [
      { key: 'prompt', label: 'Prompt', type: 'text' },
      { key: 'negative_prompt', label: 'Negative Prompt', type: 'text' },
      { key: 'image', label: 'Reference Image (optional → image-to-video)', type: 'file', accept: 'image/*', optional: true },
      { key: 'num_frames', label: 'Frames', type: 'number', default: 121 },
      { key: 'fps', label: 'FPS', type: 'number', default: 24 },
      { key: 'width', label: 'Width', type: 'number', default: 768 },
      { key: 'height', label: 'Height', type: 'number', default: 512 },
    ],
  },
  {
    id: 'animatediff', label: 'AnimateDiff', blurb: 'Text → looping SD1.5 motion animation (gif).',
    endpoint: '/api/tools/animatediff/jobs', resultKind: 'gif',
    aspects: { landscape: [512, 384], vertical: [384, 512], square: [512, 512] },
    fields: [
      { key: 'prompt', label: 'Prompt', type: 'text', placeholder: 'a fox running through a forest' },
      { key: 'negative_prompt', label: 'Negative Prompt', type: 'text' },
      { key: 'steps', label: 'Steps', type: 'number', default: 25 },
      { key: 'frames', label: 'Frames', type: 'number', default: 16 },
      { key: 'width', label: 'Width', type: 'number', default: 512 },
      { key: 'height', label: 'Height', type: 'number', default: 512 },
      { key: 'seed', label: 'Seed', type: 'number', default: -1 },
    ],
  },
]

const STYLE_CHIPS = ['Cinematic', 'Anime', 'Claymation', 'Product Shot', 'Golden Hour', 'Vintage Film']

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }
const INPUT: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }
const CHIP: React.CSSProperties = { padding: '5px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }

export function GeneratePanel({ onOpenEditor }: { onOpenEditor?: () => void }) {
  const [engineId, setEngineId] = useState(ENGINES[0].id)
  const engine = ENGINES.find(e => e.id === engineId)!
  const [values, setValues] = useState<Record<string, string | number | File | null>>({})
  const { job, start, reset } = useJobPoll('generate')
  const [library, setLibrary] = useState<VideoLibraryItem[]>([])

  function loadLibrary() {
    getVideoLibrary().then(setLibrary).catch(() => {})
  }
  useEffect(loadLibrary, [])
  useEffect(() => { if (job.status === 'done') loadLibrary() }, [job.status])

  function switchEngine(id: string) {
    setEngineId(id)
    setValues({})
    reset()
  }

  function setField(key: string, value: string | number | File | null) {
    setValues(v => ({ ...v, [key]: value }))
  }

  function applyAspect(w: number, h: number) {
    setValues(v => ({ ...v, width: w, height: h }))
  }

  function addStyleChip(style: string) {
    const current = (values.prompt as string) ?? ''
    setField('prompt', current.trim() ? `${current}, ${style.toLowerCase()}` : style.toLowerCase())
  }

  const hasPrompt = engine.fields.some(f => f.key === 'prompt')

  const requiredFilesReady = engine.fields
    .filter(f => f.type === 'file' && !f.optional)
    .every(f => values[f.key] instanceof File)
  const requiredTextReady = engine.fields
    .filter(f => f.type === 'text' && f.key === 'prompt')
    .every(f => typeof values[f.key] === 'string' && (values[f.key] as string).trim().length > 0)
  const canRun = requiredFilesReady && requiredTextReady && job.status !== 'queued' && job.status !== 'running'

  async function run() {
    const form = new FormData()
    for (const f of engine.fields) {
      const v = values[f.key]
      if (f.type === 'file') {
        if (v instanceof File) form.append(f.key, v)
      } else if (f.type === 'number') {
        form.append(f.key, String(v ?? f.default))
      } else {
        form.append(f.key, String(v ?? ''))
      }
    }
    await start(engine.endpoint, form)
  }

  const running = job.status === 'queued' || job.status === 'running'
  const downloadFilename = `${engine.id}-${timestampSlug()}.${engine.resultKind === 'gif' ? 'gif' : 'mp4'}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
      <div>
        <span style={LABEL}>Engine</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ENGINES.map(e => (
            <button
              key={e.id}
              onClick={() => switchEngine(e.id)}
              style={{
                padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                border: e.id === engineId ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: e.id === engineId ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                color: e.id === engineId ? 'var(--accent)' : 'var(--text)',
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{engine.blurb}</p>
      </div>

      {engine.aspects && (
        <div>
          <span style={LABEL}>Aspect Ratio</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => applyAspect(...engine.aspects!.landscape)} style={CHIP}>16:9 Landscape</button>
            <button type="button" onClick={() => applyAspect(...engine.aspects!.vertical)} style={CHIP}>9:16 Vertical</button>
            <button type="button" onClick={() => applyAspect(...engine.aspects!.square)} style={CHIP}>1:1 Square</button>
          </div>
        </div>
      )}

      {hasPrompt && (
        <div>
          <span style={LABEL}>Style</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STYLE_CHIPS.map(style => (
              <button key={style} type="button" onClick={() => addStyleChip(style)} style={CHIP}>+ {style}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {engine.fields.map(f => (
          <div key={f.key}>
            <span style={LABEL}>{f.label}{f.type === 'file' && !('optional' in f && f.optional) ? ' *' : ''}</span>
            {f.type === 'file' ? (
              <input
                type="file" accept={f.accept} style={{ fontSize: 12, color: 'var(--text)' }}
                onChange={e => setField(f.key, e.target.files?.[0] ?? null)}
              />
            ) : f.type === 'number' ? (
              <input
                type="number" step={f.step ?? 1} style={INPUT}
                value={(values[f.key] as number) ?? f.default}
                onChange={e => setField(f.key, Number(e.target.value))}
              />
            ) : (
              <input
                type="text" style={INPUT} placeholder={f.placeholder}
                value={(values[f.key] as string) ?? ''}
                onChange={e => setField(f.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={run} disabled={!canRun}
        style={{
          padding: '10px 24px', borderRadius: 8, fontWeight: 600, fontSize: 13, alignSelf: 'flex-start',
          background: canRun ? 'var(--accent)' : 'var(--surface2)', color: '#fff', border: 'none',
          cursor: canRun ? 'pointer' : 'not-allowed', opacity: canRun ? 1 : 0.5,
        }}
      >
        {running ? `${job.status === 'queued' ? 'Queued' : 'Rendering'}… (jobs run one at a time — single GPU)` : `Generate with ${engine.label}`}
      </button>

      {job.status === 'error' && (
        <div style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>
          <strong>Job failed</strong><br />{job.error}
        </div>
      )}

      {job.status === 'done' && job.resultPath && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><span style={LABEL}>Result</span>{onOpenEditor && <button onClick={onOpenEditor} style={{ border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Open editor to use this shot →</button>}</div>
          {engine.resultKind === 'gif' ? (
            <img src={job.resultPath} alt="result" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
          ) : (
            <video src={job.resultPath} controls style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
          )}
          <DownloadButton url={`/api/tools/jobs/${job.jobId}/download/${encodeURIComponent(downloadFilename)}`} filename={downloadFilename} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>↓ Download</DownloadButton>
        </div>
      )}

      {library.length > 0 && (
        <div>
          <span style={LABEL}>Recent Generations</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {library.slice(0, 8).map(item => (
              <div key={item.job_id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                <span style={{ fontWeight: 600, minWidth: 90, textTransform: 'capitalize' }}>{item.tool.replace('_', ' ')}</span>
                <span style={{ color: 'var(--text-muted)', flex: 1 }}>{new Date(item.created_at * 1000).toLocaleString()}</span>
                <a href={apiUrl(`/api/tools/jobs/${item.job_id}/file`)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>View</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useRef, useState } from 'react'
import { apiUrl, request } from '../../lib/api'
import { DownloadButton } from '../DownloadButton'

const STEM_COLORS: Record<string, string> = {
  vocals: '#e86db7',
  drums:  '#e6a817',
  bass:   '#4a90d9',
  other:  '#7c5cbf',
  piano:  '#4caf7d',
  guitar: '#e05252',
}

type Engine = 'demucs' | 'spleeter'
type Status = 'idle' | 'running' | 'completed' | 'failed'

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }
const SEL: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }

export function StemSeparator({ sidecarReady }: { sidecarReady: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [engine, setEngine] = useState<Engine>('demucs')
  const [stemCount, setStemCount] = useState(4)
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [stems, setStems] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) { setFile(f); setStatus('idle'); setStems({}); setError('') }
  }

  async function startSeparation() {
    if (!file) return
    setStatus('running'); setProgress(0); setStems({}); setError('')

    const form = new FormData()
    form.append('audio', file)
    form.append('engine', engine)
    form.append('stems', String(stemCount))

    try {
      const data = await request<{ job_id: string }>('/studio/stems', { method: 'POST', body: form })
      setJobId(data.job_id)

      pollRef.current = setInterval(async () => {
        try {
          const s = await request<{ status: string; progress: number; stems?: Record<string, string>; error?: string }>(
            `/studio/stems/${data.job_id}`
          )
          setProgress(s.progress ?? 0)
          if (s.status === 'completed') {
            clearInterval(pollRef.current!)
            setStatus('completed')
            setStems(s.stems ?? {})
          } else if (s.status === 'failed') {
            clearInterval(pollRef.current!)
            setStatus('failed')
            setError(s.error ?? 'Unknown error')
          }
        } catch { /* transient */ }
      }, 1500)
    } catch (e: unknown) {
      setStatus('failed')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current)
    setFile(null); setStatus('idle'); setProgress(0); setStems({}); setJobId(null); setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const disabled = !file || status === 'running'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input ref={fileRef} type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.m4a" style={{ display: 'none' }} onChange={pickFile} />

      <div>
        <span style={LABEL}>Audio File</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{ flex: 1, border: `1px dashed ${file ? 'var(--accent)' : 'var(--border)'}`, background: file ? 'rgba(124,110,247,0.06)' : 'transparent', borderRadius: 8, padding: '14px 18px', color: file ? 'var(--text)' : 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'center' }}
          >
            {file ? `🎵 ${file.name}` : 'Click to pick an audio file'}
          </div>
          {file && (
            <button onClick={reset} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={LABEL}>Engine</span>
          <select style={SEL} value={engine} disabled={status === 'running'} onChange={e => setEngine(e.target.value as Engine)}>
            <option value="demucs">Demucs v4 (recommended)</option>
            <option value="spleeter">Spleeter (faster)</option>
          </select>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={LABEL}>Stems</span>
          <select style={SEL} value={stemCount} disabled={status === 'running'} onChange={e => setStemCount(Number(e.target.value))}>
            <option value={2}>2 — Vocals + Other</option>
            <option value={4}>4 — Vocals / Drums / Bass / Other</option>
            {engine === 'demucs' && <option value={6}>6 — + Piano + Guitar</option>}
          </select>
        </div>
      </div>

      <button
        disabled={disabled}
        onClick={startSeparation}
        style={{ padding: '10px 24px', background: disabled ? 'var(--surface2)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, alignSelf: 'flex-start' }}
      >
        {status === 'running' ? 'Separating…' : 'Separate Stems'}
      </button>

      {status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.4s ease', width: `${progress}%` }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 36 }}>{progress}%</span>
        </div>
      )}

      {status === 'failed' && (
        <div style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--danger)' }}>
          <strong>Separation failed</strong><br />{error}
        </div>
      )}

      {status === 'completed' && Object.keys(stems).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={LABEL}>Stems ready</span>
          {Object.entries(stems).map(([name]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STEM_COLORS[name] ?? '#7c5cbf', flexShrink: 0, display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: 13, minWidth: 60, textTransform: 'capitalize' }}>{name}</span>
              <audio controls src={apiUrl(`/api/studio/stems/${jobId}/${name}`)} style={{ flex: 1, height: 28 }} />
              <DownloadButton url={`/api/studio/stems/${jobId}/${name}`} filename={`${name}.wav`} style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>↓ Download</DownloadButton>
            </div>
          ))}
        </div>
      )}

      {!sidecarReady && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          The Stem Separation sidecar is not running. Click <strong>Start</strong> above, or run:<br />
          <code style={{ fontFamily: 'monospace', fontSize: 11 }}>PORT=8004 python3 sidecars/stem-sep/main.py</code>
        </div>
      )}
    </div>
  )
}

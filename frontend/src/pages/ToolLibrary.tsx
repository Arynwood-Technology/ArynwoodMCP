import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  RefreshCw, Image as ImageIcon, Video, Volume2, Search,
  Database, Code2, Cpu, ExternalLink, Check,
  Box, Zap, Terminal, ChevronDown, ChevronRight, Globe,
  Play, Download, FolderOpen, Loader2,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import {
  getTools, generateImage, generateTTS,
  removeBg, upscaleImg, searchSearx, listQdrant,
  generateAlltalk, generateKokoro, scrapeFetch,
  openTool, installToolStream,
  type Tool,
} from '../lib/api'

// ── Category meta ─────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; Icon: any; color: string }> = {
  image:  { label: 'Image',             Icon: ImageIcon, color: '#fb923c' },
  audio:  { label: 'Audio',             Icon: Volume2,   color: '#5eead4' },
  video:  { label: 'Video',             Icon: Video,     color: '#f472b6' },
  '3d':   { label: '3D',                Icon: Box,       color: '#a78bfa' },
  ai:     { label: 'AI Infrastructure', Icon: Cpu,       color: '#7c6ef7' },
  search: { label: 'Search',            Icon: Search,    color: '#3b82f6' },
  data:   { label: 'Data / Vector',     Icon: Database,  color: '#22c55e' },
  code:      { label: 'Code',              Icon: Code2,     color: '#facc15' },
  scraping:  { label: 'Scraping',          Icon: Globe,     color: '#38bdf8' },
}

const STATUS_COLORS: Record<string, string> = {
  online:      '#22c55e',
  available:   '#7c6ef7',
  offline:     '#ef4444',
  unavailable: '#6b7280',
  error:       '#f59e0b',
}

const STATUS_LABELS: Record<string, string> = {
  online:      'online',
  available:   'installed',
  offline:     'offline',
  unavailable: 'not installed',
  error:       'error',
}

// ── Shared input style ────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12,
  width: '100%', boxSizing: 'border-box',
}

const runBtn = (disabled = false): React.CSSProperties => ({
  background: disabled ? 'var(--surface2)' : 'var(--accent)',
  border: 'none', color: '#fff', borderRadius: 6, padding: '8px 14px',
  cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600,
})

// ── Tool panels ───────────────────────────────────────────────────────────────

function SDPanel() {
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [steps, setSteps] = useState(20)
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState('')

  const run = async () => {
    if (!prompt) return
    setLoading(true); setError('')
    try {
      const r = await generateImage({ prompt, negative_prompt: negative, steps, width: 512, height: 512 })
      setImages(r.images)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Prompt…" rows={3} style={{ ...inp, resize: 'vertical' }} />
      <input value={negative} onChange={e => setNegative(e.target.value)} placeholder="Negative prompt…" style={inp} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Steps: {steps}</span>
        <input type="range" min={10} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))} style={{ flex: 1 }} />
      </div>
      <button onClick={run} disabled={loading || !prompt} style={runBtn(loading || !prompt)}>
        {loading ? 'Generating…' : 'Generate Image'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {images.map((img, i) => (
        <img key={i} src={`data:image/png;base64,${img}`} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
      ))}
    </div>
  )
}

function TTSPanel() {
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('random')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!text) return
    setLoading(true); setError('')
    try { await generateTTS({ text, voice }) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Text to synthesize…" rows={4} style={{ ...inp, resize: 'vertical' }} />
      <input value={voice} onChange={e => setVoice(e.target.value)} placeholder="Voice preset (random, train_lescault…)" style={inp} />
      <button onClick={run} disabled={loading || !text} style={runBtn(loading || !text)}>
        {loading ? 'Generating…' : 'Generate Speech'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
    </div>
  )
}

function AllTalkPanel() {
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('default')
  const [lang, setLang] = useState('en')
  const [loading, setLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [error, setError] = useState('')

  const run = async () => {
    if (!text) return
    setLoading(true); setError(''); setAudioUrl('')
    try {
      const r = await generateAlltalk({ text, voice, language: lang })
      if (r.output_file_url) setAudioUrl(`http://localhost:7851${r.output_file_url}`)
      else setAudioUrl('')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Text to synthesize…" rows={4} style={{ ...inp, resize: 'vertical' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
        <input value={voice} onChange={e => setVoice(e.target.value)} placeholder="Voice name (default)" style={inp} />
        <select value={lang} onChange={e => setLang(e.target.value)} style={inp}>
          {['en', 'es', 'fr', 'de', 'ja', 'zh', 'ru', 'pt', 'it', 'ko'].map(l => <option key={l}>{l}</option>)}
        </select>
      </div>
      <button onClick={run} disabled={loading || !text} style={runBtn(loading || !text)}>
        {loading ? 'Generating…' : 'Synthesize with AllTalk'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {audioUrl && (
        <audio controls src={audioUrl} style={{ width: '100%', marginTop: 4 }} />
      )}
    </div>
  )
}

function KokoroPanel() {
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('af_heart')
  const [speed, setSpeed] = useState(1.0)
  const [loading, setLoading] = useState(false)
  const [audioB64, setAudioB64] = useState('')
  const [error, setError] = useState('')

  const VOICES = ['af_heart', 'af_bella', 'af_nicole', 'am_adam', 'am_michael', 'bf_emma', 'bm_george']

  const run = async () => {
    if (!text) return
    setLoading(true); setError(''); setAudioB64('')
    try {
      const r = await generateKokoro({ text, voice, speed })
      if (r.audio_base64) setAudioB64(r.audio_base64)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Text to synthesize…" rows={4} style={{ ...inp, resize: 'vertical' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
        <select value={voice} onChange={e => setVoice(e.target.value)} style={inp}>
          {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          Speed {speed.toFixed(1)}
          <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{ display: 'block', marginTop: 2, width: 80 }} />
        </label>
      </div>
      <button onClick={run} disabled={loading || !text} style={runBtn(loading || !text)}>
        {loading ? 'Synthesizing…' : 'Synthesize with Kokoro'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {audioB64 && (
        <audio controls src={`data:audio/wav;base64,${audioB64}`} style={{ width: '100%', marginTop: 4 }} />
      )}
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Kokoro is extremely fast — most text generates in under a second.</div>
    </div>
  )
}

function RembgPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onFile = (f: File) => {
    setFile(f); setResult('')
    setPreview(URL.createObjectURL(f))
  }

  const run = async () => {
    if (!file) return
    setLoading(true); setError('')
    try {
      const form = new FormData()
      form.append('image', file)
      const r = await removeBg(form)
      if (r.image_base64) setResult(`data:image/png;base64,${r.image_base64}`)
      else throw new Error(r.detail ?? 'No result')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: 6, padding: 12, textAlign: 'center' }}>
        {file ? file.name : 'Click to upload image'}
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {preview && <img src={preview} alt="input" style={{ maxHeight: 160, objectFit: 'contain', borderRadius: 6 }} />}
      <button onClick={run} disabled={loading || !file} style={runBtn(loading || !file)}>
        {loading ? 'Removing background…' : 'Remove Background'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {result && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Result (transparent PNG):</div>
          <img src={result} alt="result" style={{ maxWidth: '100%', borderRadius: 8, background: 'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 16px 16px' }} />
          <a href={result} download="no-bg.png" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>Download PNG</a>
        </>
      )}
    </div>
  )
}

function RealESRGANPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [result, setResult] = useState('')
  const [scale, setScale] = useState(4)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onFile = (f: File) => { setFile(f); setResult(''); setPreview(URL.createObjectURL(f)) }

  const run = async () => {
    if (!file) return
    setLoading(true); setError('')
    try {
      const form = new FormData()
      form.append('image', file)
      form.append('scale', String(scale))
      const r = await upscaleImg(form)
      if (r.image_base64) setResult(`data:image/png;base64,${r.image_base64}`)
      else throw new Error(r.detail ?? 'No result')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: 6, padding: 12, textAlign: 'center' }}>
        {file ? file.name : 'Click to upload image'}
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {preview && <img src={preview} alt="input" style={{ maxHeight: 160, objectFit: 'contain', borderRadius: 6 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scale:</span>
        {[2, 4].map(s => (
          <button key={s} onClick={() => setScale(s)} style={{ background: scale === s ? 'var(--accent)' : 'var(--surface2)', border: '1px solid var(--border)', color: scale === s ? '#fff' : 'var(--text)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            {s}×
          </button>
        ))}
      </div>
      <button onClick={run} disabled={loading || !file} style={runBtn(loading || !file)}>
        {loading ? `Upscaling ${scale}×…` : `Upscale ${scale}×`}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {result && (
        <>
          <img src={result} alt="upscaled" style={{ maxWidth: '100%', borderRadius: 8 }} />
          <a href={result} download="upscaled.png" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>Download PNG</a>
        </>
      )}
    </div>
  )
}

function SadTalkerPanel() {
  const [image, setImage] = useState<File | null>(null)
  const [audio, setAudio] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [error, setError] = useState('')

  const run = async () => {
    if (!image || !audio) return
    setLoading(true); setError(''); setVideoUrl(''); setStatus('Uploading…')
    const form = new FormData()
    form.append('image', image)
    form.append('audio', audio)
    try {
      const r = await fetch('/api/tools/sadtalker/jobs', { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Failed to start job')
      setStatus('Rendering… (usually a few minutes)')

      const jobId = data.job_id
      while (true) {
        await new Promise(res => setTimeout(res, 3000))
        const jr = await fetch(`/api/tools/jobs/${jobId}`)
        const job = await jr.json()
        if (job.status === 'done') { setVideoUrl(`/api/tools/jobs/${jobId}/file`); break }
        if (job.status === 'error') throw new Error(job.error || 'SadTalker failed')
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false); setStatus('') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Portrait Image:
        <input type="file" accept="image/*" onChange={e => setImage(e.target.files?.[0] ?? null)} style={{ display: 'block', marginTop: 4, color: 'var(--text)', fontSize: 12 }} />
      </label>
      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Audio File:
        <input type="file" accept="audio/*" onChange={e => setAudio(e.target.files?.[0] ?? null)} style={{ display: 'block', marginTop: 4, color: 'var(--text)', fontSize: 12 }} />
      </label>
      <button onClick={run} disabled={loading || !image || !audio} style={runBtn(loading || !image || !audio)}>
        {loading ? (status || 'Processing…') : 'Generate Talking Head'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {videoUrl && (
        <>
          <video src={videoUrl} controls style={{ maxWidth: '100%', borderRadius: 8 }} />
          <a href={videoUrl} download="sadtalker.mp4" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>Download MP4</a>
        </>
      )}
    </div>
  )
}

function SearXNGPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!query) return
    setLoading(true); setError('')
    try {
      const r = await searchSearx(query)
      setResults(r.results)
      setSuggestions(r.suggestions)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} placeholder="Search the web…" style={{ ...inp, flex: 1 }} />
        <button onClick={run} disabled={loading || !query} style={runBtn(loading || !query)}>Search</button>
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {suggestions.slice(0, 5).map(s => (
            <button key={s} onClick={() => { setQuery(s); }} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 20, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>{s}</button>
          ))}
        </div>
      )}
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {results.map((r, i) => (
        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
          <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>{r.title}</a>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{r.url}</div>
          {r.content && <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 4, lineHeight: 1.4 }}>{r.content.slice(0, 200)}</div>}
        </div>
      ))}
    </div>
  )
}

function QdrantPanel() {
  const [collections, setCollections] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const r = await listQdrant()
      setCollections(r.collections ?? [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button onClick={load} disabled={loading} style={runBtn(loading)}>
        {loading ? 'Loading…' : 'List Collections'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {collections.length === 0 && !loading && !error && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No collections yet. Use Qdrant to store vector embeddings for RAG workflows.</div>
      )}
      {collections.map(c => (
        <div key={c.name} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>
          {c.name}
        </div>
      ))}
    </div>
  )
}

function Florence2Panel() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [task, setTask] = useState('caption')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const TASKS = ['caption', 'detailed_caption', 'more_detailed_caption', 'ocr', 'detect']

  const run = async () => {
    if (!file) return
    setLoading(true); setError('')
    const form = new FormData()
    form.append('image', file)
    form.append('task', task)
    try {
      const r = await fetch('/api/tools/florence2/caption', { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail)
      setResult(data.result)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: 6, padding: 12, textAlign: 'center' }}>
        {file ? file.name : 'Click to upload image'}
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setPreview(URL.createObjectURL(f)); setResult(null) } }} />
      </label>
      {preview && <img src={preview} alt="input" style={{ maxHeight: 160, objectFit: 'contain', borderRadius: 6 }} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TASKS.map(t => (
          <button key={t} onClick={() => setTask(t)} style={{ background: task === t ? '#fb923c22' : 'var(--surface2)', border: `1px solid ${task === t ? '#fb923c' : 'var(--border)'}`, color: task === t ? '#fb923c' : 'var(--text-muted)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>{t.replace(/_/g, ' ')}</button>
        ))}
      </div>
      <button onClick={run} disabled={loading || !file} style={runBtn(loading || !file)}>
        {loading ? 'Running Florence-2…' : 'Analyze Image'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {result && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  )
}

function ChatterboxPanel() {
  const [text, setText] = useState('')
  const [refAudio, setRefAudio] = useState<File | null>(null)
  const [exag, setExag] = useState(0.5)
  const [cfgWeight, setCfgWeight] = useState(0.5)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [error, setError] = useState('')

  const run = async () => {
    if (!text) return
    setLoading(true); setError(''); setAudioUrl(''); setStatus('Uploading…')
    const form = new FormData()
    form.append('text', text)
    form.append('exaggeration', String(exag))
    form.append('cfg_weight', String(cfgWeight))
    if (refAudio) form.append('reference_audio', refAudio)
    try {
      const r = await fetch('/api/tools/chatterbox/jobs', { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Failed to start job')
      setStatus('Generating… (first run downloads the model, can take a few minutes)')

      const jobId = data.job_id
      while (true) {
        await new Promise(res => setTimeout(res, 3000))
        const jr = await fetch(`/api/tools/jobs/${jobId}`)
        const job = await jr.json()
        if (job.status === 'done') { setAudioUrl(`/api/tools/jobs/${jobId}/file`); break }
        if (job.status === 'error') throw new Error(job.error || 'Chatterbox failed')
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false); setStatus('') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Text to synthesize…" rows={4} style={{ ...inp, resize: 'vertical' }} />
      <label style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: 6, padding: 10, textAlign: 'center' }}>
        {refAudio ? refAudio.name : 'Click to add a reference clip of your voice (optional — omit for the default voice)'}
        <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => setRefAudio(e.target.files?.[0] ?? null)} />
      </label>
      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Expressiveness: {exag.toFixed(2)}
        <input type="range" min={0} max={1} step={0.05} value={exag} onChange={e => setExag(Number(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 4 }} />
      </label>
      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Pacing (cfg weight): {cfgWeight.toFixed(2)}
        <input type="range" min={0.2} max={1} step={0.05} value={cfgWeight} onChange={e => setCfgWeight(Number(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 4 }} />
      </label>
      <button onClick={run} disabled={loading || !text} style={runBtn(loading || !text)}>
        {loading ? (status || 'Generating…') : 'Generate with Chatterbox'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
      {audioUrl && (
        <>
          <audio controls src={audioUrl} style={{ width: '100%' }} />
          <a href={audioUrl} download="chatterbox.wav" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>Download WAV</a>
        </>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Zero-shot voice cloning — add a reference clip above to clone that voice; leave it empty for Chatterbox's built-in default voice.</div>
    </div>
  )
}

function ScraplingPanel() {
  const [url, setUrl] = useState('')
  const [selector, setSelector] = useState('')
  const [fetcher, setFetcher] = useState<'basic' | 'stealthy' | 'dynamic'>('basic')
  const [output, setOutput] = useState<'text' | 'html'>('text')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<{ text: string; html: string }[]>([])
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')

  const run = async () => {
    if (!url) return
    setLoading(true); setError(''); setResults([])
    try {
      const r = await scrapeFetch({ url, selector, fetcher, output })
      setResults(r.results)
      setCount(r.count)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const FETCHERS: { key: 'basic' | 'stealthy' | 'dynamic'; label: string; hint: string }[] = [
    { key: 'basic',   label: 'Basic',   hint: 'Fast HTTP fetch' },
    { key: 'stealthy', label: 'Stealthy', hint: 'Cloudflare bypass (Camoufox)' },
    { key: 'dynamic', label: 'Dynamic',  hint: 'Full browser (Playwright)' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && run()}
        placeholder="https://example.com/page"
        style={inp}
      />
      <input
        value={selector}
        onChange={e => setSelector(e.target.value)}
        placeholder="CSS or XPath selector (optional) — e.g. .product-title or //h1"
        style={inp}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Fetcher:</span>
        {FETCHERS.map(f => (
          <button key={f.key} onClick={() => setFetcher(f.key)} title={f.hint}
            style={{ background: fetcher === f.key ? '#38bdf822' : 'var(--surface2)', border: `1px solid ${fetcher === f.key ? '#38bdf8' : 'var(--border)'}`, color: fetcher === f.key ? '#38bdf8' : 'var(--text-muted)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
            {f.label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Output:</span>
        {(['text', 'html'] as const).map(o => (
          <button key={o} onClick={() => setOutput(o)}
            style={{ background: output === o ? '#38bdf822' : 'var(--surface2)', border: `1px solid ${output === o ? '#38bdf8' : 'var(--border)'}`, color: output === o ? '#38bdf8' : 'var(--text-muted)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
            {o}
          </button>
        ))}
      </div>

      <button onClick={run} disabled={loading || !url} style={runBtn(loading || !url)}>
        {loading ? 'Fetching…' : 'Scrape'}
      </button>
      {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}

      {results.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count} result{count !== 1 ? 's' : ''}</div>
          {results.map((r, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              {output === 'html' ? (
                <pre style={{ margin: 0, fontSize: 10, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>{r.html}</pre>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.text || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(empty)</span>}</div>
              )}
            </div>
          ))}
        </>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        Basic: fast HTTP · Stealthy: Cloudflare bypass (needs Camoufox) · Dynamic: JS rendering (needs Playwright)
      </div>
    </div>
  )
}

// ── Action section — replaces copy-paste install panel ────────────────────────

function ActionSection({ tool }: { tool: Tool & { local_html?: boolean } }) {
  const [log, setLog] = useState('')
  const [running, setRunning] = useState(false)
  const [exitOk, setExitOk] = useState<boolean | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const cmd = tool.install || ''
  const isDockerCmd = cmd.startsWith('docker')
  const hasInstall = !!cmd && !cmd.startsWith('#') && !cmd.startsWith('xdg-open')
  const hasOpenUrl = !!tool.homepage
  const hasLocalFile = !!tool.local_html

  const openApp = () => {
    if (hasOpenUrl) { window.open(tool.homepage, '_blank'); return }
    openTool(tool.id).catch(() => {})
  }

  const runInstall = async () => {
    setRunning(true); setLog(`$ ${cmd}\n\n`); setExitOk(null)
    try {
      const r = await installToolStream(tool.id)
      if (!r.ok || !r.body) { setLog(l => l + `\nHTTP ${r.status}\n`); setRunning(false); return }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value)
        setLog(prev => prev + chunk)
        if (chunk.includes('✓ Done')) setExitOk(true)
        else if (chunk.includes('✗ Failed')) setExitOk(false)
      }
    } catch (e: any) {
      setLog(l => l + `\nError: ${e.message}\n`)
    }
    setRunning(false)
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const actionBtnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    border: 'none', borderRadius: 8, padding: '10px 18px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(hasOpenUrl || hasLocalFile) && (
          <button onClick={openApp} style={{ ...actionBtnBase, background: 'var(--accent)', color: '#fff' }}>
            {hasLocalFile ? <FolderOpen size={14} /> : <ExternalLink size={14} />}
            {hasLocalFile ? 'Open File' : 'Open App'}
          </button>
        )}
        {hasInstall && (
          <button onClick={runInstall} disabled={running}
            style={{ ...actionBtnBase, background: running ? 'var(--surface2)' : isDockerCmd ? '#0ea5e9' : '#7c6ef7', color: '#fff', opacity: running ? 0.7 : 1 }}>
            {running ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : isDockerCmd ? <Play size={14} /> : <Download size={14} />}
            {running ? (isDockerCmd ? 'Starting…' : 'Installing…') : isDockerCmd ? 'Start Container' : 'Install'}
          </button>
        )}
      </div>

      {log && (
        <pre ref={logRef} style={{
          background: '#0d0d0d', color: '#e2e8f0', border: '1px solid #2a2a2a',
          borderRadius: 8, padding: '12px 14px', fontSize: 11, fontFamily: 'monospace',
          maxHeight: 280, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {log}
          {exitOk === true && <span style={{ color: '#22c55e', fontWeight: 700 }}>Installation complete!</span>}
          {exitOk === false && <span style={{ color: '#ef4444', fontWeight: 700 }}>Failed — check output above.</span>}
          {running && <span style={{ color: '#94a3b8' }}>▌</span>}
        </pre>
      )}

      {!log && !hasOpenUrl && !hasLocalFile && !hasInstall && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No automated install available — see project documentation.
        </div>
      )}
    </div>
  )
}

// ── Embedded iframe panel (for local HTML tools) ──────────────────────────────

function IframePanel({ url, name }: { url: string; name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <iframe
        src={url}
        title={name}
        style={{ width: '100%', height: 640, border: '1px solid var(--border)', borderRadius: 8, background: '#000' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
      />
    </div>
  )
}

// ── Panel registry ────────────────────────────────────────────────────────────

// Interactive panels for tools with embedded UIs
const TOOL_PANELS: Record<string, (tool: Tool) => React.ReactNode> = {
  stable_diffusion:  () => <SDPanel />,
  tortoise_tts:      () => <TTSPanel />,
  alltalk_tts:       () => <AllTalkPanel />,
  kokoro_tts:        () => <KokoroPanel />,
  chatterbox:        () => <ChatterboxPanel />,
  sadtalker:         () => <SadTalkerPanel />,
  rembg:             () => <RembgPanel />,
  realesrgan:        () => <RealESRGANPanel />,
  florence2:         () => <Florence2Panel />,
  scrapling:         () => <ScraplingPanel />,
  searxng:           () => <SearXNGPanel />,
  qdrant:            () => <QdrantPanel />,
  // ── Local HTML tools — embedded in-app ──────────────────────────────────
  flowchart:         (t) => <IframePanel url={t.homepage!} name={t.name} />,
  terminal_hub:      (t) => <IframePanel url={t.homepage!} name={t.name} />,
  design_center:     (t) => <IframePanel url={t.homepage!} name={t.name} />,
  client_intake:     (t) => <IframePanel url={t.homepage!} name={t.name} />,
}

// ── Hardware profile card ─────────────────────────────────────────────────────

function HardwareCard() {
  const [hw, setHw] = useState<any>(null)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [copying, setCopying] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/system/hardware').then(r => r.json()).then(setHw).catch(() => {})
  }, [])

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopying(key)
    setTimeout(() => setCopying(null), 1500)
  }

  if (!hw) return null

  const vramFree = hw.gpu?.available
    ? Math.round((parseInt(hw.gpu.memory_total) - parseInt(hw.gpu.memory_used)) / 1024 * 10) / 10
    : 0

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Zap size={14} color="#7c6ef7" />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your Hardware</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        {hw.gpu?.available && (
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>GPU</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{hw.gpu.name}</div>
            <div style={{ fontSize: 11, color: '#22c55e', marginTop: 2 }}>{vramFree}GB free / {hw.gpu.vram_gb}GB total</div>
            {hw.gpu.temp && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hw.gpu.temp}°C · {hw.gpu.utilization}% util</div>}
          </div>
        )}
        <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>CPU</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{hw.cpu.name?.replace(/\(R\)|\(TM\)/g, '')}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hw.cpu.cores} threads</div>
        </div>
        <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>RAM</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{hw.ram_gb}GB</div>
          {hw.ram_notes?.map((n: string) => <div key={n} style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{n}</div>)}
        </div>
        <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Disk Free</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: hw.disk_free_gb > 100 ? '#22c55e' : '#f59e0b' }}>{hw.disk_free_gb}GB</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>SATA SSD (root)</div>
        </div>
      </div>

      {hw.can_run?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>GPU CAN RUN</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {hw.can_run.map((item: string) => (
              <span key={item} style={{ background: '#22c55e18', border: '1px solid #22c55e44', color: '#22c55e', borderRadius: 20, padding: '2px 8px', fontSize: 10 }}>{item}</span>
            ))}
          </div>
        </div>
      )}

      {hw.too_large?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>NEEDS MORE VRAM</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {hw.too_large.map((item: string) => (
              <span key={item} style={{ background: '#ef444418', border: '1px solid #ef444444', color: '#f87171', borderRadius: 20, padding: '2px 8px', fontSize: 10 }}>{item}</span>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => setModelsOpen(o => !o)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
        {modelsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Recommended Ollama models for your GPU
      </button>

      {modelsOpen && hw.recommended_models && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {hw.recommended_models.map((m: any) => (
            <div key={m.name} style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{m.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--surface2)', borderRadius: 4, padding: '1px 5px' }}>{m.size}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{m.desc}</div>
              </div>
              <button onClick={() => copy(m.pull, m.name)} title="Copy pull command" style={{ background: 'none', border: '1px solid var(--border)', color: copying === m.name ? '#22c55e' : 'var(--text-muted)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                {copying === m.name ? <Check size={11} /> : <Terminal size={11} />}
                {copying === m.name ? 'Copied!' : 'Copy pull'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Heavy loads card ──────────────────────────────────────────────────────────
// Toggle buttons for the two things known to permanently camp on VRAM in this
// stack — the SD checkpoint (A1111 keeps it resident even when idle) and any
// Ollama model still "hot" from a prior chat — so a GPU-heavy job like SadTalker
// can get its memory back without having to stop those services outright.

interface SdMemory { loaded: boolean; active_bytes: number; system_used_bytes: number; system_total_bytes: number }
interface OllamaRunningModel { name: string; size: number; size_vram?: number }

const gb = (bytes: number) => Math.round(bytes / 1024 / 1024 / 1024 * 10) / 10

function GpuLoadsCard() {
  const [sdMemory, setSdMemory] = useState<SdMemory | null>(null)
  const [sdBusy, setSdBusy] = useState(false)
  const [sdError, setSdError] = useState('')

  const [ollamaModels, setOllamaModels] = useState<OllamaRunningModel[]>([])
  const [ollamaBusy, setOllamaBusy] = useState<string | null>(null)

  async function refresh() {
    try {
      const r = await fetch('/api/tools/sd/memory')
      setSdMemory(r.ok ? await r.json() : null)
    } catch { setSdMemory(null) }

    try {
      const r = await fetch('/api/ollama/running')
      const d = r.ok ? await r.json() : { models: [] }
      setOllamaModels(d.models ?? [])
    } catch { setOllamaModels([]) }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [])

  async function toggleSd() {
    if (!sdMemory) return
    setSdBusy(true); setSdError('')
    const action = sdMemory.loaded ? 'unload' : 'reload'
    try {
      const r = await fetch(`/api/tools/sd/checkpoint/${action}`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
      await refresh()
    } catch (e: any) {
      setSdError(e.message ?? String(e))
    } finally {
      setSdBusy(false)
    }
  }

  async function unloadOllama(name: string) {
    setOllamaBusy(name)
    try {
      await fetch('/api/ollama/unload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
      })
      await refresh()
    } catch { /* ignore */ }
    finally { setOllamaBusy(null) }
  }

  if (!sdMemory && ollamaModels.length === 0) return null

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 8, padding: '10px 14px' }
  const dot = (on: boolean): React.CSSProperties => ({ width: 8, height: 8, borderRadius: '50%', background: on ? '#22c55e' : '#6b7280', flexShrink: 0 })
  const unloadBtn = (busy: boolean, loaded: boolean): React.CSSProperties => ({
    fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer',
    border: `1px solid ${loaded ? 'var(--danger)' : 'var(--accent)'}`,
    background: 'transparent', color: loaded ? 'var(--danger)' : 'var(--accent)',
    display: 'flex', alignItems: 'center', gap: 5,
  })

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Zap size={14} color="#f59e0b" />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Heavy Loads</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>free up VRAM for other GPU tools</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sdMemory && (
          <div style={rowStyle}>
            <div style={dot(sdMemory.loaded)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Stable Diffusion checkpoint</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {sdMemory.loaded ? `${gb(sdMemory.active_bytes)}GB in VRAM` : 'Unloaded — A1111 still running, reload is fast'}
              </div>
            </div>
            <button onClick={toggleSd} disabled={sdBusy} style={unloadBtn(sdBusy, sdMemory.loaded)}>
              {sdBusy && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
              {sdBusy ? (sdMemory.loaded ? 'Unloading…' : 'Loading…') : (sdMemory.loaded ? 'Unload' : 'Reload')}
            </button>
          </div>
        )}
        {sdError && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{sdError}</div>}

        {ollamaModels.map(m => (
          <div key={m.name} style={rowStyle}>
            <div style={dot(true)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{gb(m.size_vram ?? m.size)}GB in VRAM (Ollama)</div>
            </div>
            <button onClick={() => unloadOllama(m.name)} disabled={ollamaBusy === m.name} style={unloadBtn(ollamaBusy === m.name, true)}>
              {ollamaBusy === m.name && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
              {ollamaBusy === m.name ? 'Unloading…' : 'Unload'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tool card ─────────────────────────────────────────────────────────────────

function ToolCard({ tool, selected, onClick }: { tool: Tool & { vram_gb?: number; local_html?: boolean }; selected: boolean; onClick: () => void }) {
  const cat = CATEGORY_META[tool.category] ?? CATEGORY_META['image']
  const { Icon } = cat
  const statusColor = STATUS_COLORS[tool.status] ?? '#6b7280'
  const statusLabel = STATUS_LABELS[tool.status] ?? tool.status
  const hasPanel = !!TOOL_PANELS[tool.id]
  const canLaunch = tool.status === 'online' && tool.homepage
  const canOpenFile = tool.status === 'available' && tool.local_html

  const launch = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (canLaunch) { window.open(tool.homepage, '_blank'); return }
    if (canOpenFile) { openTool(tool.id).catch(() => {}) }
  }

  return (
    <div onClick={onClick} style={{
      background: 'var(--surface2)',
      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
      transition: 'border-color 0.15s',
      opacity: tool.status === 'unavailable' ? 0.55 : 1,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <Icon size={16} color={cat.color} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(canLaunch || canOpenFile) && (
            <button onClick={launch} title="Open" style={{
              background: cat.color + '22', border: `1px solid ${cat.color}55`,
              color: cat.color, borderRadius: 6, padding: '2px 8px',
              cursor: 'pointer', fontSize: 10, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              {canOpenFile ? <FolderOpen size={10} /> : <ExternalLink size={10} />}
              {canOpenFile ? 'Open' : 'Launch'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
            <span style={{ fontSize: 9, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{statusLabel}</span>
          </div>
        </div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{tool.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{tool.description}</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {tool.port && <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}>:{tool.port}</span>}
        {(tool as any).vram_gb && <span style={{ fontSize: 10, color: '#a78bfa', background: '#a78bfa18', borderRadius: 4, padding: '2px 6px' }}>{(tool as any).vram_gb}GB VRAM</span>}
        {hasPanel && <span style={{ fontSize: 10, color: cat.color, background: `${cat.color}18`, borderRadius: 4, padding: '2px 6px' }}>interactive</span>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ToolLibrary() {
  const { tools, setTools } = useAppStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [filterCat, setFilterCat] = useState<string>('all')
  const detailRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  const load = async () => {
    try { setTools(await getTools()) } catch {}
  }

  useEffect(() => { load() }, [])

  // Auto-open a tool if navigated here with { state: { openTool: 'id' } }
  useEffect(() => {
    const openToolId = (location.state as any)?.openTool
    if (openToolId && tools.length > 0) {
      setSelected(openToolId)
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
    }
  }, [location.state, tools.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTool = tools.find(t => t.id === selected)
  const categories = ['all', ...Object.keys(CATEGORY_META).filter(c => tools.some(t => t.category === c))]
  const visible = filterCat === 'all' ? tools : tools.filter(t => t.category === filterCat)

  const handleSelect = (id: string) => {
    setSelected(prev => prev === id ? null : id)
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }

  // Count by status
  const online = tools.filter(t => t.status === 'online').length
  const available = tools.filter(t => t.status === 'available').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

        <HardwareCard />
        <GpuLoadsCard />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {tools.length} tools — {online} online, {available} installed
            </div>
          </div>
          <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {categories.map(cat => {
            const meta = cat === 'all' ? null : CATEGORY_META[cat]
            const active = filterCat === cat
            return (
              <button key={cat} onClick={() => setFilterCat(cat)} style={{
                background: active ? (meta?.color ?? 'var(--accent)') + '22' : 'var(--surface2)',
                border: `1px solid ${active ? (meta?.color ?? 'var(--accent)') : 'var(--border)'}`,
                color: active ? (meta?.color ?? 'var(--accent)') : 'var(--text-muted)',
                borderRadius: 20, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}>
                {cat === 'all' ? 'All' : meta?.label}
              </button>
            )
          })}
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 28 }}>
          {visible.map(t => (
            <ToolCard key={t.id} tool={t} selected={selected === t.id} onClick={() => handleSelect(t.id)} />
          ))}
        </div>

        {/* Detail panel */}
        {selectedTool && (
          <div ref={detailRef} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h3 style={{ margin: 0, color: 'var(--text)', fontSize: 16 }}>{selectedTool.name}</h3>
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: STATUS_COLORS[selectedTool.status] ?? '#6b7280',
                  background: (STATUS_COLORS[selectedTool.status] ?? '#6b7280') + '18',
                  borderRadius: 4, padding: '2px 7px',
                }}>
                  {STATUS_LABELS[selectedTool.status] ?? selectedTool.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedTool.description}</div>
            </div>

            {/* Actions always shown at top */}
            <div style={{ marginBottom: TOOL_PANELS[selectedTool.id] ? 20 : 0 }}>
              <ActionSection tool={selectedTool} />
            </div>

            {/* Interactive panel if this tool has one */}
            {TOOL_PANELS[selectedTool.id] && (
              <>
                {(selectedTool.status === 'offline' || selectedTool.status === 'unavailable') && (
                  <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 12 }}>
                    ⚠ {selectedTool.status === 'offline' ? 'Service is offline — use the button above to start it.' : 'Not installed — use the Install button above first.'}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
                  {TOOL_PANELS[selectedTool.id](selectedTool)}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

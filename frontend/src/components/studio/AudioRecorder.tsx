import { useEffect, useRef, useState } from 'react'
import { audioBufferToWavBlob, blobToBase64, sliceAudioBuffer } from '../../lib/wav'
import { describeMicError, nextDeviceId, openMicStream, usableInputs } from '../../lib/mic'

type Phase = 'idle' | 'recording' | 'review'

interface BrowseResult { path: string; parent: string | null; home: string; dirs: string[] }

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }
const SEL: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, width: '100%' }
const BTN: React.CSSProperties = { padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }
const BTN_ACCENT: React.CSSProperties = { padding: '10px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }

function timestamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

interface AudioRecorderProps {
  onSendToEffects: (blob: Blob) => void
  onSendToVoice?: (blob: Blob) => void
  onSendToJam?: (blob: Blob) => void
}

export function AudioRecorder({ onSendToEffects, onSendToVoice, onSendToJam }: AudioRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState('')

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [playingPreview, setPlayingPreview] = useState(false)

  const [saveOpen, setSaveOpen] = useState(false)
  const [saveDir, setSaveDir] = useState<BrowseResult | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<'start' | 'end' | null>(null)
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const previewEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function ctx(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    return audioCtxRef.current
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    refreshDevices()
    return () => {
      stopStream()
      audioCtxRef.current?.close()
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      if (previewEndTimerRef.current) clearTimeout(previewEndTimerRef.current)
    }
  }, [])

  async function refreshDevices() {
    try {
      const inputs = usableInputs(await navigator.mediaDevices.enumerateDevices())
      setDevices(inputs)
      setDeviceId(prev => nextDeviceId(prev, inputs))
    } catch { /* permission not granted yet */ }
  }

  function tickLevel() {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
    setLevel(Math.sqrt(sum / data.length))
    levelRafRef.current = requestAnimationFrame(tickLevel)
  }

  async function startRecording() {
    setError('')
    try {
      const stream = await openMicStream(deviceId)
      streamRef.current = stream
      await refreshDevices()

      const audioContext = ctx()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      tickLevel()

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = handleRecordingStop
      recorder.start()
      recorderRef.current = recorder

      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
      setPhase('recording')
    } catch (e: unknown) {
      setError(describeMicError(e))
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null }
    setLevel(0)
    // Don't stop the stream here — MediaRecorder.stop() is async and needs the
    // stream alive to flush its final chunk and fire `onstop`. Killing the mic
    // tracks synchronously right after calling stop() can make `onstop` never
    // fire at all (seen on Chromium), which is what made Stop Recording hang.
    // The stream gets released in handleRecordingStop once stop has actually
    // completed.
  }

  async function handleRecordingStop() {
    stopStream()
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' })
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const decoded = await ctx().decodeAudioData(arrayBuffer)
      setBuffer(decoded)
      setTrimStart(0)
      setTrimEnd(decoded.duration)
      setPhase('review')
    } catch (e: unknown) {
      setError('Could not decode recording: ' + (e instanceof Error ? e.message : String(e)))
      setPhase('idle')
    }
  }

  function discard() {
    stopPreview()
    setBuffer(null)
    setElapsed(0)
    setPhase('idle')
  }

  // Draw waveform + trim overlay together so dragging redraws live
  useEffect(() => {
    const canvas = canvasRef.current
    if (!buffer || !canvas) return
    const c2d = canvas.getContext('2d')
    if (!c2d) return
    const w = canvas.width, h = canvas.height
    c2d.clearRect(0, 0, w, h)

    const data = buffer.getChannelData(0)
    const step = Math.max(1, Math.ceil(data.length / w))
    c2d.strokeStyle = '#7c6ef7'
    c2d.lineWidth = 1
    c2d.beginPath()
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1
      const base = x * step
      for (let i = 0; i < step; i++) {
        const idx = base + i
        if (idx >= data.length) break
        const v = data[idx]
        if (v < min) min = v
        if (v > max) max = v
      }
      const y1 = ((1 - max) / 2) * h
      const y2 = ((1 - min) / 2) * h
      c2d.moveTo(x, y1)
      c2d.lineTo(x, Math.max(y2, y1 + 1))
    }
    c2d.stroke()

    const startX = (trimStart / buffer.duration) * w
    const endX = (trimEnd / buffer.duration) * w
    c2d.fillStyle = 'rgba(0,0,0,0.45)'
    c2d.fillRect(0, 0, startX, h)
    c2d.fillRect(endX, 0, w - endX, h)
    c2d.fillStyle = '#7c6ef7'
    c2d.fillRect(startX - 2, 0, 3, h)
    c2d.fillRect(endX - 1, 0, 3, h)
  }, [buffer, trimStart, trimEnd])

  function xToSec(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas || !buffer) return 0
    const rect = canvas.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return frac * buffer.duration
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!buffer) return
    const sec = xToSec(e.clientX)
    dragRef.current = Math.abs(sec - trimStart) <= Math.abs(sec - trimEnd) ? 'start' : 'end'
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current || !buffer) return
    const sec = xToSec(e.clientX)
    if (dragRef.current === 'start') setTrimStart(Math.min(sec, trimEnd - 0.05))
    else setTrimEnd(Math.max(sec, trimStart + 0.05))
  }

  function onPointerUp() {
    dragRef.current = null
  }

  function stopPreview() {
    try { previewSourceRef.current?.stop() } catch { /* already stopped */ }
    previewSourceRef.current = null
    if (previewEndTimerRef.current) { clearTimeout(previewEndTimerRef.current); previewEndTimerRef.current = null }
    setPlayingPreview(false)
  }

  function playPreview() {
    if (!buffer) return
    stopPreview()
    const audioContext = ctx()
    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(audioContext.destination)
    const duration = Math.max(0, trimEnd - trimStart)
    source.start(0, trimStart, duration)
    previewSourceRef.current = source
    setPlayingPreview(true)
    previewEndTimerRef.current = setTimeout(() => { setPlayingPreview(false); previewSourceRef.current = null }, duration * 1000)
  }

  function buildTrimmedWav(): Blob | null {
    if (!buffer) return null
    return audioBufferToWavBlob(sliceAudioBuffer(buffer, trimStart, trimEnd))
  }

  function download() {
    const wav = buildTrimmedWav()
    if (!wav) return
    const url = URL.createObjectURL(wav)
    const a = document.createElement('a')
    a.href = url
    a.download = `voiceover-${timestamp()}.wav`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  function sendToEffects() {
    const wav = buildTrimmedWav()
    if (wav) onSendToEffects(wav)
  }

  function sendToVoice() {
    const wav = buildTrimmedWav()
    if (wav) onSendToVoice?.(wav)
  }

  function sendToJam() {
    const wav = buildTrimmedWav()
    if (wav) onSendToJam?.(wav)
  }

  async function browse(path: string, fallback = false) {
    try {
      const r = await fetch('/api/fs/browse-home?path=' + encodeURIComponent(path))
      if (!r.ok) {
        if (fallback && path !== '~') return browse('~')
        const d = await r.json().catch(() => ({}))
        throw new Error(d.detail || `HTTP ${r.status}`)
      }
      setSaveDir(await r.json())
    } catch (e: unknown) {
      setSaveDir(null)
      setSaveStatus('Backend not reachable — use Download instead. ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function openSaveDialog() {
    setSaveName(`voiceover-${timestamp()}.wav`)
    setSaveStatus('')
    setSaveOpen(true)
    let start = '~/Videos'
    try { start = localStorage.getItem('studio_save_dir') || start } catch { /* ignore */ }
    await browse(start, true)
  }

  async function mkdir() {
    if (!saveDir) return
    const name = prompt('New folder name:')
    if (!name) return
    try {
      const r = await fetch('/api/fs/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent: saveDir.path, name }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
      await browse(d.created)
    } catch (e: unknown) {
      setSaveStatus('Could not create folder: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function saveToFolder() {
    setSaveStatus('')
    if (!saveDir) { setSaveStatus('No folder selected — browse above or use Download instead.'); return }
    const name = saveName.trim()
    if (!/^[\w][\w .()-]*\.wav$/i.test(name)) { setSaveStatus('Filename must end in .wav and contain no slashes.'); return }
    const wav = buildTrimmedWav()
    if (!wav) return
    setSaving(true)
    try {
      const data = await blobToBase64(wav)
      const r = await fetch('/api/fs/save-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: saveDir.path, filename: name, data }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
      try { localStorage.setItem('studio_save_dir', saveDir.path) } catch { /* ignore */ }
      setSaveOpen(false)
    } catch (e: unknown) {
      setSaveStatus('Save failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  const selectedDuration = buffer ? Math.max(0, trimEnd - trimStart) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Record narration through your mic, trim the take, then save it as a WAV to sync with your screen capture in kdenlive — or send it to the Effects Rack for cleanup first.
      </p>

      {phase !== 'review' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={LABEL}>Microphone</span>
          <select style={SEL} value={deviceId} disabled={phase === 'recording'} onChange={e => setDeviceId(e.target.value)}>
            {devices.length === 0 && <option value="">Default microphone</option>}
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {phase === 'idle' ? (
              <button onClick={startRecording} style={{ ...BTN_ACCENT }}>● Start Recording</button>
            ) : (
              <button onClick={stopRecording} style={{ ...BTN_ACCENT, background: 'var(--danger)' }}>■ Stop Recording</button>
            )}
            {phase === 'recording' && (
              <>
                <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'monospace' }}>{formatTime(elapsed)}</span>
                <div style={{ flex: 1, maxWidth: 160, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, level * 220)}%`, background: level > 0.35 ? 'var(--warning)' : 'var(--accent)', transition: 'width 0.08s linear' }} />
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {phase === 'review' && buffer && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={LABEL}>Trim ({formatTime(trimStart)} – {formatTime(trimEnd)}, {selectedDuration.toFixed(1)}s selected)</span>
          <canvas
            ref={canvasRef}
            width={760}
            height={110}
            style={{ width: '100%', height: 110, borderRadius: 8, cursor: 'ew-resize', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button style={BTN} onClick={playingPreview ? stopPreview : playPreview}>{playingPreview ? '■ Stop' : '▶ Play Selection'}</button>
            <button style={BTN} onClick={discard}>↺ Re-record</button>
            <button style={{ ...BTN_ACCENT, padding: '7px 16px' }} onClick={download}>↓ Download WAV</button>
            <button style={BTN} onClick={openSaveDialog}>📁 Save to Folder…</button>
            <button style={BTN} onClick={sendToEffects}>🎚 Send to Effects Rack →</button>
            {onSendToVoice && <button style={BTN} onClick={sendToVoice}>🎭 Send to Voice Profiles →</button>}
            {onSendToJam && <button style={BTN} onClick={sendToJam}>🎸 Send to Jam →</button>}
          </div>
        </section>
      )}

      {error && <div style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      {saveOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setSaveOpen(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 420, display: 'flex', flexDirection: 'column', gap: 12 }} onClick={e => e.stopPropagation()}>
            <span style={LABEL}>Save Voiceover</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saveDir?.path ?? '—'}</span>
              <button style={{ ...BTN, padding: '4px 10px', fontSize: 11 }} onClick={mkdir} disabled={!saveDir}>+ Folder</button>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 180, overflow: 'auto' }}>
              {saveDir?.parent && (
                <div onClick={() => browse(saveDir.parent!)} style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>⬑ ..</div>
              )}
              {saveDir?.dirs.map(name => (
                <div key={name} onClick={() => browse(saveDir.path + '/' + name)} style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>📁 {name}</div>
              ))}
              {saveDir && !saveDir.dirs.length && !saveDir.parent && (
                <div style={{ padding: '7px 12px', fontSize: 12, color: 'var(--text-muted)' }}>no subfolders</div>
              )}
            </div>

            <input style={SEL} type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="filename.wav" />

            {saveStatus && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{saveStatus}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={BTN} onClick={() => setSaveOpen(false)}>Cancel</button>
              <button style={BTN} onClick={download}>↓ Download Instead</button>
              <button style={{ ...BTN_ACCENT, padding: '7px 16px' }} onClick={saveToFolder} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

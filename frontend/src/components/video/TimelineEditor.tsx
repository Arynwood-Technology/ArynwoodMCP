import { useEffect, useRef, useState } from 'react'
import { Scissors, Play, Pause, Mic, Square, Magnet, Trash2, Captions, Sparkles } from 'lucide-react'
import { useJobPoll } from './useJobPoll'
import { getVideoLibrary, type VideoLibraryItem } from '../../lib/api'
import { computePeaks, drawWaveform } from '../../lib/waveform'
import { audioBufferToWavBlob } from '../../lib/wav'
import { describeMicError } from '../../lib/mic'
import { timestampSlug } from '../../lib/filename'
import type { CaptionSegment } from './CaptionsPanel'
import {
  useVideoEditorStore,
  type Clip, type LookId, type TransitionType, type Canvas, type AudioTrack, type CaptionCue,
} from '../../store/useVideoEditorStore'

const LOOK_PRESETS: { id: LookId; label: string; swatch: string }[] = [
  { id: 'none', label: 'None', swatch: 'linear-gradient(135deg, #444, #666)' },
  { id: 'cinematic', label: 'Cinematic', swatch: 'linear-gradient(135deg, #1a2a3a, #c9915a)' },
  { id: 'teal_orange', label: 'Teal & Orange', swatch: 'linear-gradient(135deg, #0d5c63, #e8823c)' },
  { id: 'golden_hour', label: 'Golden Hour', swatch: 'linear-gradient(135deg, #d98e3f, #f4c874)' },
  { id: 'noir', label: 'Noir', swatch: 'linear-gradient(135deg, #111, #eee)' },
  { id: 'bleach_bypass', label: 'Bleach Bypass', swatch: 'linear-gradient(135deg, #3a3a3a, #d8d8c8)' },
  { id: 'vintage_film', label: 'Vintage Film', swatch: 'linear-gradient(135deg, #7a6a8a, #d9b98a)' },
  { id: 'dreamy', label: 'Dreamy', swatch: 'linear-gradient(135deg, #f2c6d8, #b8d4f0)' },
  { id: 'cyberpunk', label: 'Cyberpunk', swatch: 'linear-gradient(135deg, #1a0a3a, #ff2fd0)' },
]

// CSS filter() approximations of each server-side ffmpeg look preset, applied
// live to the preview <video>/<img> — not a faithful match (CSS can't do
// per-channel color balance the way ffmpeg's colorbalance/curves filters can),
// just enough to see roughly what a look will do before rendering.
const LOOK_CSS_FILTER: Record<LookId, string> = {
  none: 'none',
  cinematic: 'contrast(1.1) saturate(1.1) brightness(1.02)',
  teal_orange: 'sepia(0.15) saturate(1.4) contrast(1.1) hue-rotate(-8deg)',
  golden_hour: 'sepia(0.25) saturate(1.3) brightness(1.05) contrast(1.05)',
  noir: 'grayscale(1) contrast(1.4) brightness(0.95)',
  bleach_bypass: 'saturate(0.3) contrast(1.35) brightness(1.05)',
  vintage_film: 'sepia(0.3) contrast(0.85) brightness(1.05) saturate(0.8)',
  dreamy: 'contrast(0.9) brightness(1.08) saturate(0.95) blur(1px)',
  cyberpunk: 'saturate(1.4) contrast(1.2) hue-rotate(-15deg) brightness(1.02)',
}

// Playback rate presets — pitch-corrected server-side via ffmpeg's atempo
// filter chain, and reflected live in preview via HTMLVideoElement.playbackRate.
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

const TRANSITION_CYCLE: TransitionType[] = ['cut', 'fade', 'slideleft', 'slideup']
const TRANSITION_LABEL: Record<TransitionType, string> = { cut: 'Cut', fade: 'Fade', slideleft: 'Slide Left', slideup: 'Slide Up' }

const CANVAS_OPTIONS: { id: Canvas; label: string }[] = [
  { id: 'landscape', label: '16:9 Landscape' },
  { id: 'vertical', label: '9:16 Vertical' },
  { id: 'square', label: '1:1 Square' },
  { id: 'auto', label: 'Auto (match 1st clip)' },
]
const CANVAS_ASPECT: Record<Canvas, string> = { landscape: '16/9', vertical: '9/16', square: '1/1', auto: '16/9' }

interface JamendoTrack { id: string; name: string; artist: string; duration: number; image: string; audio_url: string; license_url: string }
const JAMENDO_TAGS = ['', 'chill', 'cinematic', 'electronic', 'acoustic', 'ambient', 'rock', 'pop', 'jazz', 'lounge', 'upbeat']
function fmtDuration(s: number) { const m = Math.floor(s / 60); const r = Math.round(s % 60); return `${m}:${String(r).padStart(2, '0')}` }

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }
const TRACK_HEIGHT = 64
const AUDIO_ROW_GAP = 4 // must match the audio-rows wrapper's flex `gap` below
const CAPTION_HEIGHT = 30
const HANDLE_W = 10
const MIN_DUR = 0.2
const DEFAULT_DUR_GUESS = 3 // shown briefly before a clip's real duration loads

function effEnd(c: Clip): number {
  return c.trimEnd ?? c.duration ?? c.trimStart + DEFAULT_DUR_GUESS
}
function effDur(c: Clip): number {
  // trimStart/trimEnd stay in source time; speed only rescales how much of
  // the timeline that trimmed segment occupies once played back.
  return Math.max((effEnd(c) - c.trimStart) / c.speed, MIN_DUR)
}
function layoutOf(clips: Clip[], pxPerSec: number) {
  let x = 0
  return clips.map(c => {
    const width = effDur(c) * pxPerSec
    const entry = { key: c.key, x, width }
    x += width
    return entry
  })
}
// Which clip (and its start time in seconds) is under a given timeline time —
// built by reusing layoutOf at a 1px-per-second scale rather than a parallel
// seconds-only implementation.
function clipAtTime(clips: Clip[], t: number): { clip: Clip; clipStart: number } | null {
  const secLayout = layoutOf(clips, 1)
  for (const entry of secLayout) {
    if (t >= entry.x && t < entry.x + entry.width) {
      return { clip: clips.find(c => c.key === entry.key)!, clipStart: entry.x }
    }
  }
  const last = secLayout[secLayout.length - 1]
  if (last && t >= last.x + last.width) {
    return { clip: clips.find(c => c.key === last.key)!, clipStart: last.x }
  }
  return null
}

function audioEffEnd(t: AudioTrack): number {
  return t.trimEnd ?? t.duration ?? t.trimStart + DEFAULT_DUR_GUESS
}
function audioEffDur(t: AudioTrack): number {
  return Math.max(audioEffEnd(t) - t.trimStart, MIN_DUR)
}
// Audio tracks float freely at their own offset rather than packing
// left-to-right like clips, so this can't reuse layoutOf.
function audioLayoutOf(tracks: AudioTrack[], pxPerSec: number) {
  return tracks.map(t => ({ key: t.key, x: t.offset * pxPerSec, width: audioEffDur(t) * pxPerSec }))
}
// Total timeline length — the greatest of the clips' own end, the furthest
// audio track's end, and the furthest caption cue's end, so a music bed,
// voiceover, or caption placed past the last clip still extends what
// Play/scrub/render cover.
function totalDuration(clips: Clip[], audioTracks: AudioTrack[], captions: CaptionCue[]): number {
  const clipEnd = clips.reduce((sum, c) => sum + effDur(c), 0)
  const audioEnd = audioTracks.reduce((max, t) => Math.max(max, t.offset + audioEffDur(t)), 0)
  const captionEnd = captions.reduce((max, c) => Math.max(max, c.end), 0)
  return Math.max(clipEnd, audioEnd, captionEnd)
}

function srtTimestamp(t: number): string {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const ms = Math.round((t - Math.floor(t)) * 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

// Mirrors the backend's _segments_to_srt formatting (sequential numbering,
// HH:MM:SS,mmm timestamps) so cues edited here round-trip through the render
// endpoint's subtitles burn-in pass unchanged.
function cuesToSrt(cues: CaptionCue[]): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  return sorted.map((cue, i) => `${i + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text.trim()}\n`).join('\n')
}

type Selection = { kind: 'clip'; key: string } | { kind: 'audio'; key: string } | { kind: 'caption'; key: string } | null

export function TimelineEditor({ active = true, pendingCaptions, onCaptionsImported, onOpenCaptions, onOpenGenerate }: {
  active?: boolean
  pendingCaptions?: CaptionSegment[] | null
  onCaptionsImported?: () => void
  onOpenCaptions?: () => void
  onOpenGenerate?: () => void
}) {
  const [library, setLibrary] = useState<VideoLibraryItem[]>([])
  // Project data (clips/transitions/canvas/audioTracks/muteClipAudio/captions/
  // peaksByKey/pxPerSec/snapEnabled) lives in useVideoEditorStore rather than
  // local useState — this component used to lose the entire timeline the
  // moment you navigated to a different page, since plain useState dies with
  // the component. The store lives outside React entirely, so it survives.
  const clips = useVideoEditorStore(s => s.clips)
  const setClips = useVideoEditorStore(s => s.setClips)
  const pxPerSec = useVideoEditorStore(s => s.pxPerSec)
  const setPxPerSec = useVideoEditorStore(s => s.setPxPerSec)
  const [splitMode, setSplitMode] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const snapEnabled = useVideoEditorStore(s => s.snapEnabled)
  const setSnapEnabled = useVideoEditorStore(s => s.setSnapEnabled)
  const [isFileOver, setIsFileOver] = useState(false)
  const canvas = useVideoEditorStore(s => s.canvas)
  const setCanvas = useVideoEditorStore(s => s.setCanvas)
  const transitions = useVideoEditorStore(s => s.transitions)
  const setTransitions = useVideoEditorStore(s => s.setTransitions)
  const { job, start, reset } = useJobPoll('render')

  // ── Audio tracks (music, voiceover, …) ──────────────────────────────────
  const audioTracks = useVideoEditorStore(s => s.audioTracks)
  const setAudioTracks = useVideoEditorStore(s => s.setAudioTracks)
  const muteClipAudio = useVideoEditorStore(s => s.muteClipAudio)
  const setMuteClipAudio = useVideoEditorStore(s => s.setMuteClipAudio)
  const peaksByKey = useVideoEditorStore(s => s.peaksByKey)
  const setPeaksByKey = useVideoEditorStore(s => s.setPeaksByKey)
  const waveformCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map())

  // ── Captions ──────────────────────────────────────────────────────────
  const captions = useVideoEditorStore(s => s.captions)
  const setCaptions = useVideoEditorStore(s => s.setCaptions)

  const [showMusicBrowser, setShowMusicBrowser] = useState(false)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicTag, setMusicTag] = useState('')
  const [musicOrder, setMusicOrder] = useState<'popularity_total' | 'releasedate'>('popularity_total')
  const [musicResults, setMusicResults] = useState<JamendoTrack[]>([])
  const [musicSearching, setMusicSearching] = useState(false)
  const [musicError, setMusicError] = useState('')
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null)
  const [fetchingTrackId, setFetchingTrackId] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  // ── Preview playback ─────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [previewShowsImage, setPreviewShowsImage] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [scrubbing, setScrubbing] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const previewImgRef = useRef<HTMLImageElement>(null)
  const audioElRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const rafRef = useRef<number | null>(null)
  const clockRef = useRef<{ wallStart: number; playheadStart: number } | null>(null)
  const activeClipKeyRef = useRef<string | null>(null)
  const sharedAudioCtxRef = useRef<AudioContext | null>(null)

  // tick() is a plain function redefined every render, but once
  // requestAnimationFrame(tick) kicks off the preview loop it keeps
  // recursively calling that SAME closure indefinitely — so if it read
  // `clips`/`audioTracks` directly, adding or adjusting a track while
  // already playing (e.g. auditioning music against footage that's
  // currently running) would silently never be picked up by the running
  // loop. These refs stay current via the effects below so tick() always
  // sees live state regardless of how long it's been running.
  const clipsRef = useRef(clips)
  useEffect(() => { clipsRef.current = clips }, [clips])
  const audioTracksRef = useRef(audioTracks)
  useEffect(() => { audioTracksRef.current = audioTracks }, [audioTracks])
  const captionsRef = useRef(captions)
  useEffect(() => { captionsRef.current = captions }, [captions])
  const muteClipAudioRef = useRef(muteClipAudio)
  useEffect(() => { muteClipAudioRef.current = muteClipAudio }, [muteClipAudio])

  function audioCtx(): AudioContext {
    if (!sharedAudioCtxRef.current) sharedAudioCtxRef.current = new AudioContext()
    return sharedAudioCtxRef.current
  }

  // ── Live voiceover recording ─────────────────────────────────────────────
  const [recording, setRecording] = useState(false)
  const [micRequesting, setMicRequesting] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [recordElapsed, setRecordElapsed] = useState(0)
  const [recordLevel, setRecordLevel] = useState(0)
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([])
  const [micDeviceId, setMicDeviceId] = useState('')
  const micStreamRef = useRef<MediaStream | null>(null)
  const recProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const recChannelsRef = useRef<Float32Array[][]>([])
  const recSampleRateRef = useRef(44100)
  const recDataEventsRef = useRef<{ count: number; totalBytes: number }>({ count: 0, totalBytes: 0 })
  const micDiagnosticsRef = useRef('')
  const recordStartOffsetRef = useRef(0)
  const recordStartTimeRef = useRef(0)
  const recordAnalyserRef = useRef<AnalyserNode | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep one transition slot per junction between adjacent clips, preserving
  // existing choices by position when clips are added/removed/reordered.
  useEffect(() => {
    const needed = Math.max(clips.length - 1, 0)
    setTransitions(cur => {
      if (cur.length === needed) return cur
      const next = cur.slice(0, needed)
      while (next.length < needed) next.push({ type: 'cut', duration: 0.5 })
      return next
    })
  }, [clips.length, setTransitions])

  // Captions arrive as a one-shot push from the Captions tab ("Send to
  // Editor") via a prop, not a persisted store — land them on the caption
  // row at their native (already 0-based) timestamps and immediately hand
  // back control via onCaptionsImported so the parent clears the pending
  // value (otherwise re-visiting this effect with the same prop reference
  // would be a no-op, but a *new* send while one is already pending would
  // never be able to fire again).
  useEffect(() => {
    if (!pendingCaptions || pendingCaptions.length === 0) return
    setCaptions(cur => [
      ...cur,
      ...pendingCaptions.map(seg => ({ key: crypto.randomUUID(), start: seg.start, end: seg.end, text: seg.text })),
    ])
    onCaptionsImported?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCaptions])

  function cycleTransition(i: number) {
    setTransitions(cur => cur.map((t, idx) => idx === i
      ? { type: TRANSITION_CYCLE[(TRANSITION_CYCLE.indexOf(t.type) + 1) % TRANSITION_CYCLE.length], duration: t.duration }
      : t))
  }
  function updateTransitionDuration(i: number, duration: number) {
    setTransitions(cur => cur.map((t, idx) => idx === i ? { ...t, duration } : t))
  }

  const trackRef = useRef<HTMLDivElement>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const dragOffsetRef = useRef(0)
  const [trimDrag, setTrimDrag] = useState<{ kind: 'clip' | 'audio' | 'caption'; key: string; edge: 'start' | 'end'; startClientX: number; startVal: number } | null>(null)

  // ── Audio-track drag-to-reposition ───────────────────────────────────────
  const [audioDragKey, setAudioDragKey] = useState<string | null>(null)
  const audioDragOffsetRef = useRef(0)
  const audioDragStartRef = useRef(0)
  const audioRowsRef = useRef<HTMLDivElement>(null)

  // ── Caption-cue drag-to-reposition (both edges move together) ───────────
  const [captionDragKey, setCaptionDragKey] = useState<string | null>(null)
  const captionDragOffsetRef = useRef(0)
  const captionDragStartRef = useRef(0) // cue.start at mousedown

  useEffect(() => {
    getVideoLibrary().then(setLibrary).catch(() => {})
  }, [])

  // Load each clip's real duration once — skips isImage clips (gif/photo):
  // a <video> element can't load either format, so there's nothing to
  // discover; they get a fixed default duration at creation time instead.
  useEffect(() => {
    clips.forEach(c => {
      if (c.duration != null || c.isImage) return
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.src = c.previewUrl
      v.onloadedmetadata = () => {
        const dur = v.duration
        setClips(cur => cur.map(x => x.key === c.key ? { ...x, duration: dur, trimEnd: x.trimEnd ?? dur } : x))
      }
    })
  }, [clips, setClips])

  // Decode each new audio track's real duration + waveform peaks once.
  // Recording pre-seeds peaksByKey/duration itself, so this skips it.
  const audioTrackKeys = audioTracks.map(t => t.key).join(',')
  useEffect(() => {
    audioTracks.forEach(track => {
      // Start loading its <audio> element right away rather than waiting
      // for playback to first need it — gives metadata a head start so
      // syncAudioTracks's readyState check is far less likely to have to
      // fall back to the loadedmetadata listener mid-playback.
      getAudioEl(track)
      if (peaksByKey[track.key]) return
      track.file.arrayBuffer()
        .then(buf => audioCtx().decodeAudioData(buf))
        .then(decoded => {
          setPeaksByKey(cur => ({ ...cur, [track.key]: computePeaks(decoded) }))
          setAudioTracks(cur => cur.map(t => t.key === track.key && t.duration == null
            ? { ...t, duration: decoded.duration, trimEnd: t.trimEnd ?? decoded.duration }
            : t))
        })
        .catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioTrackKeys])

  // Redraw waveforms on zoom/trim/offset changes — never on playhead, so this
  // never runs at animation-frame frequency.
  useEffect(() => {
    for (const track of audioTracks) {
      const canvas = waveformCanvasRefs.current.get(track.key)
      const peaks = peaksByKey[track.key]
      if (!canvas || !peaks) continue
      const width = Math.max(1, Math.round(audioEffDur(track) * pxPerSec))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== TRACK_HEIGHT) canvas.height = TRACK_HEIGHT
      const dur = track.duration ?? audioEffEnd(track)
      const startFrac = dur > 0 ? track.trimStart / dur : 0
      const endFrac = dur > 0 ? audioEffEnd(track) / dur : 1
      drawWaveform(canvas, peaks, { startFrac, endFrac })
    }
  }, [pxPerSec, audioTracks, peaksByKey])

  function addFromLibrary(item: VideoLibraryItem) {
    const isImage = item.tool === 'animatediff' // gif output — img preview, not video
    setClips(c => [...c, {
      key: crypto.randomUUID(), sourceType: 'job', jobId: item.job_id,
      label: `${item.tool} — ${new Date(item.created_at * 1000).toLocaleTimeString()}`,
      previewUrl: `/api/tools/jobs/${item.job_id}/file`,
      isImage, isPhoto: false, look: 'none', speed: 1,
      duration: null, trimStart: 0, trimEnd: null,
    }])
  }

  // Drag-and-drop from a file manager often leaves File.type empty — many
  // Linux desktop environments don't register a MIME type for every video
  // container (.mkv, .webm, sometimes .mp4), so relying on f.type alone
  // silently drops the file with no feedback. Fall back to the extension.
  const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg', 'ogv', 'flv', 'wmv']
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']

  function classifyUpload(f: File): 'video' | 'image' | null {
    if (f.type.startsWith('video/')) return 'video'
    if (f.type.startsWith('image/')) return 'image'
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (VIDEO_EXT.includes(ext)) return 'video'
    if (IMAGE_EXT.includes(ext)) return 'image'
    return null
  }

  function addUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setClips(c => [
      ...c,
      ...Array.from(files).filter(f => classifyUpload(f) !== null).map(f => {
        const isImage = classifyUpload(f) === 'image'
        const isPhoto = isImage && f.type !== 'image/gif' && !f.name.toLowerCase().endsWith('.gif')
        return {
          key: crypto.randomUUID(), sourceType: 'upload' as const, file: f,
          label: f.name, previewUrl: URL.createObjectURL(f),
          isImage, isPhoto, look: 'none' as LookId, speed: 1,
          // Photos/gifs have no metadata to load — a sensible, immediately
          // editable default (drag the end handle to hold it longer).
          duration: isImage ? 3 : null, trimStart: 0, trimEnd: isImage ? 3 : null,
        }
      }),
    ])
  }

  function remove(key: string) {
    setClips(c => c.filter(x => x.key !== key))
    setSelection(sel => sel?.kind === 'clip' && sel.key === key ? null : sel)
  }

  function updateClipLook(key: string, look: LookId) {
    setClips(c => c.map(x => x.key === key ? { ...x, look } : x))
  }
  function updateClipSpeed(key: string, speed: number) {
    setClips(c => c.map(x => x.key === key ? { ...x, speed } : x))
  }

  // ── Drag-to-reorder (clips) ──────────────────────────────────────────────
  function onBlockMouseDown(e: React.MouseEvent, clip: Clip) {
    if (splitMode) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dragOffsetRef.current = e.clientX - rect.left
    setDragKey(clip.key)
    e.preventDefault()
  }

  useEffect(() => {
    if (!dragKey) return
    function onMove(e: MouseEvent) {
      const track = trackRef.current
      if (!track) return
      const trackRect = track.getBoundingClientRect()
      const pointerX = e.clientX - trackRect.left + track.scrollLeft
      setClips(cur => {
        const idx = cur.findIndex(c => c.key === dragKey)
        if (idx === -1) return cur
        const dragged = cur[idx]
        const others = cur.filter(c => c.key !== dragKey)
        const layout = layoutOf(others, pxPerSec)
        const proposedCenter = pointerX - dragOffsetRef.current + (effDur(dragged) * pxPerSec) / 2
        let target = others.length
        for (let i = 0; i < layout.length; i++) {
          if (proposedCenter < layout[i].x + layout[i].width / 2) { target = i; break }
        }
        const next = [...others]
        next.splice(target, 0, dragged)
        return next
      })
    }
    function onUp() { setDragKey(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragKey, pxPerSec, setClips])

  // ── Drag-to-reposition (audio tracks — horizontal = offset, vertical = layer order) ─
  function onAudioBlockMouseDown(e: React.MouseEvent, track: AudioTrack) {
    if (splitMode) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    audioDragOffsetRef.current = e.clientX - rect.left
    audioDragStartRef.current = track.offset
    setAudioDragKey(track.key)
    e.preventDefault()
  }

  useEffect(() => {
    if (!audioDragKey) return
    function onMove(e: MouseEvent) {
      const track = trackRef.current
      if (!track) return
      const trackRect = track.getBoundingClientRect()
      const pointerX = e.clientX - trackRect.left + track.scrollLeft
      const rawOffset = Math.max(0, (pointerX - audioDragOffsetRef.current) / pxPerSec)
      const newOffset = snapSeconds(rawOffset, getSnapPoints(audioDragKey))

      setAudioTracks(cur => {
        const idx = cur.findIndex(t => t.key === audioDragKey)
        if (idx === -1) return cur
        const next = cur.map(t => t.key === audioDragKey ? { ...t, offset: newOffset } : t)

        // Vertical movement reorders which row/layer the track sits in —
        // measured against the audio-rows section specifically (not the
        // whole timeline, whose height varies with clip presence above it).
        const rowsEl = audioRowsRef.current
        if (rowsEl) {
          const rowsRect = rowsEl.getBoundingClientRect()
          const pointerY = e.clientY - rowsRect.top + rowsEl.scrollTop
          const rowH = TRACK_HEIGHT + AUDIO_ROW_GAP
          const targetIdx = Math.min(next.length - 1, Math.max(0, Math.floor(pointerY / rowH)))
          if (targetIdx !== idx) {
            const [moved] = next.splice(idx, 1)
            next.splice(targetIdx, 0, moved)
          }
        }
        return next
      })
    }
    function onUp() { setAudioDragKey(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // getSnapPoints/snapSeconds are plain (non-memoized) component functions —
    // deliberately left out so this drag listener doesn't re-subscribe on
    // every unrelated render (e.g. playhead advancing during playback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioDragKey, pxPerSec, setAudioTracks])

  // ── Caption-cue drag-to-reposition (both edges move together) ───────────
  function onCaptionBlockMouseDown(e: React.MouseEvent, cue: CaptionCue) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    captionDragOffsetRef.current = e.clientX - rect.left
    captionDragStartRef.current = cue.start
    setCaptionDragKey(cue.key)
    e.preventDefault()
  }

  useEffect(() => {
    if (!captionDragKey) return
    function onMove(e: MouseEvent) {
      const track = trackRef.current
      if (!track) return
      const trackRect = track.getBoundingClientRect()
      const pointerX = e.clientX - trackRect.left + track.scrollLeft
      const rawStart = Math.max(0, (pointerX - captionDragOffsetRef.current) / pxPerSec)
      const newStart = snapSeconds(rawStart, getSnapPoints(undefined, captionDragKey))
      setCaptions(cur => cur.map(c => {
        if (c.key !== captionDragKey) return c
        const dur = c.end - c.start
        return { ...c, start: newStart, end: newStart + dur }
      }))
    }
    function onUp() { setCaptionDragKey(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // getSnapPoints/snapSeconds deliberately omitted — see the audio-drag effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionDragKey, pxPerSec, setCaptions])

  // ── Trim by dragging clip/audio-track edges ──────────────────────────────
  function onClipHandleMouseDown(e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    setTrimDrag({ kind: 'clip', key: clip.key, edge, startClientX: e.clientX, startVal: edge === 'start' ? clip.trimStart : effEnd(clip) })
  }
  function onAudioHandleMouseDown(e: React.MouseEvent, track: AudioTrack, edge: 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    setTrimDrag({ kind: 'audio', key: track.key, edge, startClientX: e.clientX, startVal: edge === 'start' ? track.trimStart : audioEffEnd(track) })
  }
  function onCaptionHandleMouseDown(e: React.MouseEvent, cue: CaptionCue, edge: 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    setTrimDrag({ kind: 'caption', key: cue.key, edge, startClientX: e.clientX, startVal: edge === 'start' ? cue.start : cue.end })
  }

  useEffect(() => {
    if (!trimDrag) return
    function onMove(e: MouseEvent) {
      const deltaSec = (e.clientX - trimDrag!.startClientX) / pxPerSec
      if (trimDrag!.kind === 'clip') {
        setClips(cur => {
          const idx = cur.findIndex(c => c.key === trimDrag!.key)
          if (idx === -1) return cur
          const c = cur[idx]
          // Both handles resize the block from a fixed left edge (its
          // position is determined entirely by preceding clips, same as
          // every packed-timeline layout here) — so regardless of which
          // handle is dragged, the geometrically meaningful "moving"
          // boundary to snap is always this clip's own right edge.
          const clipStartOnTimeline = layoutOf(cur, 1)[idx].x
          // Real video clips can't be trimmed past their actual length; a photo
          // is looped to fit whatever duration you drag it to, so it's uncapped.
          const dur = c.isImage ? Infinity : (c.duration ?? Infinity)
          // deltaSec is an on-timeline pixel delta; trimStart/trimEnd are in
          // source time, so it has to be rescaled by speed — at 2x, dragging
          // one on-timeline second moves the source trim point by two.
          const sourceDelta = deltaSec * c.speed
          if (trimDrag!.edge === 'start') {
            const maxStart = effEnd(c) - MIN_DUR
            const rawTrimStart = Math.min(Math.max(trimDrag!.startVal + sourceDelta, 0), maxStart)
            const rawEffDur = Math.max((effEnd(c) - rawTrimStart) / c.speed, MIN_DUR)
            const snappedRightEdge = snapSeconds(clipStartOnTimeline + rawEffDur, getSnapPoints())
            const snappedEffDur = Math.max(snappedRightEdge - clipStartOnTimeline, MIN_DUR)
            const trimStart = Math.min(Math.max(effEnd(c) - snappedEffDur * c.speed, 0), maxStart)
            return cur.map((x, i) => i === idx ? { ...x, trimStart } : x)
          }
          const minEnd = c.trimStart + MIN_DUR
          const rawTrimEnd = Math.min(Math.max(trimDrag!.startVal + sourceDelta, minEnd), dur)
          const rawEffDur = Math.max((rawTrimEnd - c.trimStart) / c.speed, MIN_DUR)
          const snappedRightEdge = snapSeconds(clipStartOnTimeline + rawEffDur, getSnapPoints())
          const snappedEffDur = Math.max(snappedRightEdge - clipStartOnTimeline, MIN_DUR)
          const trimEnd = Math.min(Math.max(c.trimStart + snappedEffDur * c.speed, minEnd), dur)
          return cur.map((x, i) => i === idx ? { ...x, trimEnd } : x)
        })
      } else if (trimDrag!.kind === 'audio') {
        setAudioTracks(cur => {
          const idx = cur.findIndex(t => t.key === trimDrag!.key)
          if (idx === -1) return cur
          const t = cur[idx]
          const dur = t.duration ?? Infinity
          if (trimDrag!.edge === 'start') {
            const maxStart = audioEffEnd(t) - MIN_DUR
            const rawTrimStart = Math.min(Math.max(trimDrag!.startVal + deltaSec, 0), maxStart)
            const rawEffDur = Math.max(audioEffEnd(t) - rawTrimStart, MIN_DUR)
            const snappedRightEdge = snapSeconds(t.offset + rawEffDur, getSnapPoints(t.key))
            const snappedEffDur = Math.max(snappedRightEdge - t.offset, MIN_DUR)
            const trimStart = Math.min(Math.max(audioEffEnd(t) - snappedEffDur, 0), maxStart)
            return cur.map((x, i) => i === idx ? { ...x, trimStart } : x)
          }
          const minEnd = t.trimStart + MIN_DUR
          const rawTrimEnd = Math.min(Math.max(trimDrag!.startVal + deltaSec, minEnd), dur)
          const rawEffDur = Math.max(rawTrimEnd - t.trimStart, MIN_DUR)
          const snappedRightEdge = snapSeconds(t.offset + rawEffDur, getSnapPoints(t.key))
          const snappedEffDur = Math.max(snappedRightEdge - t.offset, MIN_DUR)
          const trimEnd = Math.min(Math.max(t.trimStart + snappedEffDur, minEnd), dur)
          return cur.map((x, i) => i === idx ? { ...x, trimEnd } : x)
        })
      } else {
        // Captions have no underlying source media, so unlike clips/audio
        // there's no duration cap to respect — start/end can each move
        // freely as long as the cue stays at least MIN_DUR long.
        setCaptions(cur => {
          const idx = cur.findIndex(c => c.key === trimDrag!.key)
          if (idx === -1) return cur
          const cue = cur[idx]
          if (trimDrag!.edge === 'start') {
            const maxStart = cue.end - MIN_DUR
            const rawStart = Math.min(Math.max(trimDrag!.startVal + deltaSec, 0), maxStart)
            const start = Math.min(Math.max(snapSeconds(rawStart, getSnapPoints(undefined, cue.key)), 0), maxStart)
            return cur.map((x, i) => i === idx ? { ...x, start } : x)
          }
          const minEnd = cue.start + MIN_DUR
          const rawEnd = Math.max(trimDrag!.startVal + deltaSec, minEnd)
          const end = Math.max(snapSeconds(rawEnd, getSnapPoints(undefined, cue.key)), minEnd)
          return cur.map((x, i) => i === idx ? { ...x, end } : x)
        })
      }
    }
    function onUp() { setTrimDrag(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // getSnapPoints/snapSeconds deliberately omitted — see the audio-drag effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimDrag, pxPerSec, setClips, setAudioTracks, setCaptions])

  // ── Razor / split ─────────────────────────────────────────────────────────
  function splitClipAt(clip: Clip, splitPoint: number) {
    const end = effEnd(clip)
    if (splitPoint <= clip.trimStart + MIN_DUR || splitPoint >= end - MIN_DUR) return
    setClips(cur => {
      const idx = cur.findIndex(c => c.key === clip.key)
      if (idx === -1) return cur
      const first: Clip = { ...clip, trimEnd: splitPoint }
      const second: Clip = { ...clip, key: crypto.randomUUID(), trimStart: splitPoint, trimEnd: clip.trimEnd }
      const next = [...cur]
      next.splice(idx, 1, first, second)
      return next
    })
  }

  // Unlike clips (packed left-to-right, so at most one occupies a given
  // timeline moment), audio tracks float freely and can overlap — so
  // splitting "whichever audio is under the playhead" is ambiguous without
  // a selected track to disambiguate. splitClipAt's identity convention
  // (first half keeps the original key, second half is new) carries over;
  // the new half's peaks are copied rather than left to redecode, so its
  // waveform doesn't flash blank right after the cut.
  function splitAudioTrackAt(track: AudioTrack, sourceSplitPoint: number) {
    const end = audioEffEnd(track)
    if (sourceSplitPoint <= track.trimStart + MIN_DUR || sourceSplitPoint >= end - MIN_DUR) return
    const newKey = crypto.randomUUID()
    setAudioTracks(cur => {
      const idx = cur.findIndex(t => t.key === track.key)
      if (idx === -1) return cur
      const first: AudioTrack = { ...track, trimEnd: sourceSplitPoint }
      const second: AudioTrack = {
        ...track, key: newKey,
        offset: track.offset + (sourceSplitPoint - track.trimStart),
        trimStart: sourceSplitPoint, trimEnd: track.trimEnd,
      }
      const next = [...cur]
      next.splice(idx, 1, first, second)
      return next
    })
    setPeaksByKey(cur => cur[track.key] ? { ...cur, [newKey]: cur[track.key] } : cur)
  }

  // kdenlive-style: 'S' splits whichever clip is under the playhead, without
  // needing to click a precise pixel position. For audio, that ambiguity
  // (multiple tracks can overlap the same moment) is resolved by requiring
  // the selected item to be the audio track the playhead currently covers.
  function splitAtPlayhead() {
    if (selection?.kind === 'audio') {
      const track = audioTracksRef.current.find(t => t.key === selection.key)
      if (track) {
        const start = track.offset
        const end = start + audioEffDur(track)
        if (playhead > start && playhead < end) {
          splitAudioTrackAt(track, track.trimStart + (playhead - start))
          return
        }
      }
    }
    const hit = clipAtTime(clipsRef.current, playhead)
    if (!hit) return
    const splitPoint = hit.clip.trimStart + (playhead - hit.clipStart) * hit.clip.speed
    splitClipAt(hit.clip, splitPoint)
  }

  function onBlockClick(e: React.MouseEvent, clip: Clip) {
    e.stopPropagation()
    if (splitMode) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      // Click offset within the block is an on-timeline pixel distance;
      // rescale by speed to land on the right source-time split point.
      const splitPoint = clip.trimStart + ((e.clientX - rect.left) / pxPerSec) * clip.speed
      splitClipAt(clip, splitPoint)
      return
    }
    setSelection({ kind: 'clip', key: clip.key })
  }

  function onAudioBlockClick(e: React.MouseEvent, track: AudioTrack) {
    e.stopPropagation()
    if (splitMode) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      splitAudioTrackAt(track, track.trimStart + (e.clientX - rect.left) / pxPerSec)
      return
    }
    setSelection({ kind: 'audio', key: track.key })
  }

  function removeAudioTrack(key: string) {
    setAudioTracks(cur => cur.filter(t => t.key !== key))
    setPeaksByKey(cur => { const next = { ...cur }; delete next[key]; return next })
    const el = audioElRefs.current.get(key)
    if (el) { el.pause(); audioElRefs.current.delete(key) }
    setSelection(sel => sel?.kind === 'audio' && sel.key === key ? null : sel)
  }
  function updateAudioTrackVolume(key: string, volume: number) {
    setAudioTracks(cur => cur.map(t => t.key === key ? { ...t, volume } : t))
  }

  function removeCaption(key: string) {
    setCaptions(cur => cur.filter(c => c.key !== key))
    setSelection(sel => sel?.kind === 'caption' && sel.key === key ? null : sel)
  }
  function updateCaptionText(key: string, text: string) {
    setCaptions(cur => cur.map(c => c.key === key ? { ...c, text } : c))
  }
  function addAudioFile(files: FileList | null) {
    if (!files || files.length === 0) return
    // Materialize the FileList into plain File objects synchronously — the
    // caller resets the <input>'s value right after this call (so the same
    // file can be re-selected), which clears the live FileList out from
    // under a setState updater if Array.from(files) were deferred inside it.
    const newTracks = Array.from(files).map(f => ({
      key: crypto.randomUUID(), file: f, previewUrl: URL.createObjectURL(f), label: f.name,
      offset: 0, duration: null, trimStart: 0, trimEnd: null, volume: 1,
    }))
    setAudioTracks(cur => [...cur, ...newTracks])
    setSelection({ kind: 'audio', key: newTracks[newTracks.length - 1].key })
  }

  // ── Preview playback clock ───────────────────────────────────────────────
  // play() rejections and decode errors used to be silently swallowed
  // (.catch(() => {})) — meaning a blocked or failed preview looked exactly
  // like nothing at all: the playhead clock kept advancing (it's driven by
  // performance.now(), independent of whether any media element is actually
  // playing) while the video/audio just sat frozen with zero feedback.
  function reportPreviewError(context: string, err: unknown) {
    let detail = 'unknown error'
    if (err instanceof DOMException) {
      if (err.name === 'AbortError') return // expected churn from switching clips rapidly, not a real failure
      detail = `${err.name} — ${err.message}`
    } else if (err && typeof err === 'object' && 'code' in err) {
      const codes: Record<number, string> = { 1: 'load aborted', 2: 'network error', 3: 'decode error', 4: 'format/source not supported' }
      const mediaErr = err as MediaError
      detail = codes[mediaErr.code] || `error code ${mediaErr.code}`
    } else if (err instanceof Error) {
      detail = err.message
    }
    const next = `${context}: ${detail}`
    setPreviewError(prev => (prev === next ? prev : next))
  }

  function getAudioEl(track: AudioTrack): HTMLAudioElement {
    let el = audioElRefs.current.get(track.key)
    if (!el) {
      el = new Audio(track.previewUrl)
      el.preload = 'auto'
      audioElRefs.current.set(track.key, el)
    }
    return el
  }

  function syncActiveClip(t: number, isPlaying: boolean) {
    const video = previewVideoRef.current
    const img = previewImgRef.current
    const hit = clipAtTime(clipsRef.current, t)
    if (!hit) { video?.pause(); activeClipKeyRef.current = null; return }
    const { clip, clipStart } = hit
    // t - clipStart is elapsed on-timeline time; rescale by speed to get
    // elapsed source time (a 2x clip burns through 2 source-seconds per
    // on-timeline second).
    const sourceTime = clip.trimStart + (t - clipStart) * clip.speed

    if (clip.isImage) {
      if (img && img.getAttribute('src') !== clip.previewUrl) img.src = clip.previewUrl
      video?.pause()
      activeClipKeyRef.current = clip.key
      setPreviewShowsImage(true)
      return
    }
    setPreviewShowsImage(false)
    if (!video) return
    // Mirrors mute_clip_audio's effect in the render endpoint — without this
    // the preview always played each clip's own audio at full volume even
    // with "Mute original clip audio" checked, which could bury a quieter
    // music/voiceover track under it so thoroughly it seemed like the extra
    // track wasn't playing at all, even though the final render (which does
    // respect the toggle) was correct.
    video.muted = muteClipAudioRef.current
    video.playbackRate = clip.speed
    if (activeClipKeyRef.current !== clip.key) {
      activeClipKeyRef.current = clip.key
      video.src = clip.previewUrl
      const onReady = () => {
        video.currentTime = sourceTime
        video.playbackRate = clip.speed
        if (isPlaying) video.play().catch(e => reportPreviewError('Video', e))
        video.removeEventListener('loadedmetadata', onReady)
      }
      video.addEventListener('loadedmetadata', onReady)
    } else if (Math.abs(video.currentTime - sourceTime) > 0.2) {
      video.currentTime = sourceTime
    } else if (isPlaying && video.paused) {
      video.play().catch(e => reportPreviewError('Video', e))
    } else if (!isPlaying && !video.paused) {
      video.pause()
    }
  }

  function syncAudioTracks(t: number, isPlaying: boolean) {
    const tracks = audioTracksRef.current
    const liveKeys = new Set(tracks.map(tr => tr.key))
    for (const [key, el] of audioElRefs.current) {
      if (!liveKeys.has(key)) { el.pause(); audioElRefs.current.delete(key) }
    }
    for (const track of tracks) {
      const el = getAudioEl(track)
      el.volume = Math.min(Math.max(track.volume, 0), 1)
      const start = track.offset
      const end = track.offset + audioEffDur(track)
      if (isPlaying && t >= start && t < end) {
        const sourceTime = track.trimStart + (t - start)
        // A freshly-created <audio> element (getAudioEl creates it lazily,
        // right here on first use) hasn't loaded metadata yet — setting
        // currentTime before readyState reaches HAVE_METADATA is silently
        // ignored by the browser, so a trimmed track would just start
        // playing from 0 instead of trimStart. Defer the seek+play until
        // metadata is actually available, same as the clip video handling.
        if (el.readyState >= 1) {
          if (el.paused) {
            // Track is just becoming active — land it at the right spot
            // before starting playback.
            el.currentTime = sourceTime
            el.play().catch(e => reportPreviewError(`Audio track "${track.label}"`, e))
          } else if (Math.abs(el.currentTime - sourceTime) > 0.75) {
            // A tight 0.2s threshold checked every animation frame was
            // "correcting" ordinary clock jitter between the JS wall clock
            // and the <audio> element's own playback clock — the two never
            // track each other with sub-200ms precision even during
            // flawless playback. Every one of those corrections seeks a
            // playing <audio> element, and every such seek produces an
            // audible click, which is what sounded like a dirty recording.
            // 0.75s only fires on an actual desync (stutter, buffering
            // stall), which is rare enough that the occasional real
            // resync is an acceptable trade.
            el.currentTime = sourceTime
          }
        } else {
          el.addEventListener('loadedmetadata', () => {
            el.currentTime = sourceTime
            if (isPlaying) el.play().catch(e => reportPreviewError(`Audio track "${track.label}"`, e))
          }, { once: true })
        }
      } else if (!el.paused) {
        el.pause()
      }
    }
  }

  function tick() {
    const clock = clockRef.current
    if (!clock) return
    const total = totalDuration(clipsRef.current, audioTracksRef.current, captionsRef.current)
    const t = clock.playheadStart + (performance.now() - clock.wallStart) / 1000
    if (t >= total) {
      setPlayhead(total)
      syncActiveClip(total, false)
      syncAudioTracks(total, false)
      pausePreview()
      return
    }
    setPlayhead(t)
    syncActiveClip(t, true)
    syncAudioTracks(t, true)
    rafRef.current = requestAnimationFrame(tick)
  }

  function playPreview() {
    const total = totalDuration(clipsRef.current, audioTracksRef.current, captionsRef.current)
    if (total <= 0) return
    const start = playhead >= total ? 0 : playhead
    clockRef.current = { wallStart: performance.now(), playheadStart: start }
    setPlaying(true)
    setPreviewError('')
    rafRef.current = requestAnimationFrame(tick)
  }

  function pausePreview() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    clockRef.current = null
    setPlaying(false)
    previewVideoRef.current?.pause()
    for (const el of audioElRefs.current.values()) el.pause()
  }

  // The Editor tab stays mounted (just CSS-hidden) when you switch away, so
  // work in progress survives — but an invisible tab has no business
  // burning CPU on video decode/rAF, so pause playback when it's hidden.
  // Timeline/audio-track state is untouched; this only stops active playback.
  useEffect(() => {
    if (!active && playing) pausePreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function togglePlay() {
    if (playing) pausePreview()
    else playPreview()
  }

  function seekTo(t: number) {
    const total = totalDuration(clipsRef.current, audioTracksRef.current, captionsRef.current)
    const clamped = Math.min(Math.max(t, 0), total)
    setPlayhead(clamped)
    syncActiveClip(clamped, playing)
    syncAudioTracks(clamped, playing)
    if (playing) clockRef.current = { wallStart: performance.now(), playheadStart: clamped }
  }

  function xToTime(clientX: number): number {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left + track.scrollLeft) / pxPerSec)
  }

  // ── Magnetic snapping ─────────────────────────────────────────────────────
  const SNAP_PX = 8

  // On-timeline positions worth snapping to: 0, the playhead, every clip
  // boundary, every other audio track's boundary, and every other caption
  // cue's boundary. `excludeAudioKey`/`excludeCaptionKey` keep an item being
  // dragged from "snapping to itself".
  function getSnapPoints(excludeAudioKey?: string | null, excludeCaptionKey?: string | null): number[] {
    const points = [0, playhead]
    for (const entry of layoutOf(clipsRef.current, 1)) {
      points.push(entry.x, entry.x + entry.width)
    }
    for (const track of audioTracksRef.current) {
      if (track.key === excludeAudioKey) continue
      points.push(track.offset, track.offset + audioEffDur(track))
    }
    for (const cue of captionsRef.current) {
      if (cue.key === excludeCaptionKey) continue
      points.push(cue.start, cue.end)
    }
    return points
  }

  function snapSeconds(proposed: number, points: number[]): number {
    if (!snapEnabled) return proposed
    const thresholdSec = SNAP_PX / pxPerSec
    let best = proposed
    let bestDist = thresholdSec
    for (const p of points) {
      const d = Math.abs(p - proposed)
      if (d < bestDist) { bestDist = d; best = p }
    }
    return best
  }

  function onRulerMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    setScrubbing(true)
    seekTo(xToTime(e.clientX))
  }

  useEffect(() => {
    if (!scrubbing) return
    function onMove(e: MouseEvent) { seekTo(xToTime(e.clientX)) }
    function onUp() { setScrubbing(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubbing, pxPerSec, clips, audioTracks, playing])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  // A normal (non-rAF-persisted) effect, so it correctly re-subscribes with a
  // fresh closure whenever its dependencies change — unlike tick(), this
  // doesn't need the ref indirection.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection) return
        e.preventDefault()
        if (selection.kind === 'clip') remove(selection.key)
        else if (selection.kind === 'audio') removeAudioTrack(selection.key)
        else removeCaption(selection.key)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        splitAtPlayhead()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, playing, playhead, clips])

  // ── Live voiceover recording ─────────────────────────────────────────────
  async function refreshMicDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list.filter(d => d.kind === 'audioinput')
      setMicDevices(inputs)
      setMicDeviceId(prev => prev || inputs[0]?.deviceId || '')
    } catch {
      // permission not granted yet — device list (and labels) fill in after the first successful recording
    }
  }

  useEffect(() => {
    // Fetch-on-mount: populate the input-device list once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMicDevices()
  }, [])

  function tickLevel() {
    const analyser = recordAnalyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
    setRecordLevel(Math.sqrt(sum / data.length))
    levelRafRef.current = requestAnimationFrame(tickLevel)
  }

  const RECORD_BUFFER_SIZE = 4096

  async function startVoiceoverRecording() {
    setRecordError('')
    recordStartOffsetRef.current = playhead
    recordStartTimeRef.current = Date.now()
    // Start preview playback synchronously, in the same call stack as the
    // click, before awaiting mic permission — awaiting first can lose the
    // user-gesture context Safari/Chrome need to allow autoplay.
    playPreview()
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordError(window.isSecureContext
        ? "This browser doesn't support microphone recording."
        : 'Microphone access requires a secure context — open this page as http://localhost:5180 (or over HTTPS), not a plain-HTTP LAN address.')
      return
    }
    setMicRequesting(true)
    try {
      // Browsers apply voice-chat DSP (echo cancellation, noise suppression,
      // auto-gain) to getUserMedia audio by default — tuned for things like
      // Zoom calls, and known to sometimes badly mangle or near-silence
      // signal from audio interfaces / pro gear the algorithms don't expect,
      // even though the same hardware works fine everywhere else. Off by
      // default here since this is a voiceover/content-recording use case,
      // not a voice call.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        },
      })
      micStreamRef.current = stream
      await refreshMicDevices() // labels are only populated once permission has been granted at least once

      // Capture into a ref (not just local vars) so this is still readable
      // from handleVoiceoverStop's error path — by the time that runs,
      // stopVoiceoverRecording has already stopped the tracks and nulled
      // micStreamRef, so this is the only chance to record what the browser
      // actually negotiated vs. what we requested.
      const audioTrack = stream.getAudioTracks()[0]
      const settings = audioTrack?.getSettings?.() ?? {}
      micDiagnosticsRef.current = audioTrack
        ? `track label="${audioTrack.label}" enabled=${audioTrack.enabled} muted=${audioTrack.muted} readyState=${audioTrack.readyState} `
          + `settings={sampleRate:${settings.sampleRate},channelCount:${settings.channelCount},echoCancellation:${settings.echoCancellation},autoGainControl:${settings.autoGainControl},noiseSuppression:${settings.noiseSuppression}}`
        : 'no audio track on stream'

      const ctx = audioCtx()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      recordAnalyserRef.current = analyser
      tickLevel()

      // Captures raw PCM directly off the Web Audio graph instead of going
      // through MediaRecorder — this app also runs inside a Tauri desktop
      // shell on Linux (WebKitGTK webview), whose MediaRecorder/GStreamer
      // audio pipeline is known to silently produce empty output for some
      // capture devices (confirmed directly: ondataavailable fired exactly
      // once with 0 bytes, even after forcing periodic flushes via a
      // timeslice — that's a fix for Apple Safari's MediaRecorder bug, and
      // this isn't Apple Safari). Reading samples off the same graph
      // already feeding the level meter's AnalyserNode above sidesteps
      // MediaRecorder's container/codec/flush behavior entirely — every
      // engine, including WebKitGTK, has always supported
      // ScriptProcessorNode, unlike MediaRecorder's format support.
      const channelCount = Math.max(1, source.channelCount || 1)
      const processor = ctx.createScriptProcessor(RECORD_BUFFER_SIZE, channelCount, 1)
      recChannelsRef.current = Array.from({ length: channelCount }, () => [])
      recSampleRateRef.current = ctx.sampleRate
      recDataEventsRef.current = { count: 0, totalBytes: 0 }
      processor.onaudioprocess = e => {
        recDataEventsRef.current.count++
        for (let ch = 0; ch < channelCount; ch++) {
          const data = e.inputBuffer.getChannelData(ch)
          recChannelsRef.current[ch].push(new Float32Array(data))
          recDataEventsRef.current.totalBytes += data.length * 4
        }
        // This node exists only to observe samples, not play them back —
        // zero the output so nothing reaches the speakers.
        for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) {
          e.outputBuffer.getChannelData(ch).fill(0)
        }
      }
      source.connect(processor)
      // Some engines only pump onaudioprocess while the node is part of a
      // live graph reaching the destination, even with its output silenced.
      processor.connect(ctx.destination)
      recProcessorRef.current = processor

      setRecordElapsed(0)
      recordTimerRef.current = setInterval(() => setRecordElapsed(e => e + 1), 1000)
      setRecording(true)
    } catch (e: unknown) {
      setRecordError(describeMicError(e))
      // leave preview playback running — the user may just want to keep watching
    } finally {
      setMicRequesting(false)
    }
  }

  function stopVoiceoverRecording() {
    const processor = recProcessorRef.current
    if (processor) {
      // Null the handler before disconnecting so no already-queued callback
      // can push one more chunk after we've started reading recChannelsRef.
      processor.onaudioprocess = null
      processor.disconnect()
      recProcessorRef.current = null
    }
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null }
    setRecordLevel(0)
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current = null
    setRecording(false)
    pausePreview()
    handleVoiceoverStop()
  }

  function handleVoiceoverStop() {
    // Gate on how long the button was actually held, not sample count — a
    // real click-and-immediately-stop is the only case worth silently
    // ignoring; anything longer that still captured nothing is a genuine
    // problem worth surfacing (wrong input device, muted mic, permission
    // granted but the hardware not actually feeding audio).
    if (Date.now() - recordStartTimeRef.current < 400) return
    const channels = recChannelsRef.current
    try {
      const totalFrames = channels[0]?.reduce((sum, chunk) => sum + chunk.length, 0) ?? 0
      if (totalFrames === 0) {
        throw new Error(
          'No audio data was captured — check that the correct microphone is selected and not muted. '
          + `[diagnostics: capture callbacks=${recDataEventsRef.current.count}, ${micDiagnosticsRef.current}]`,
        )
      }
      const numChannels = channels.length
      const decoded = audioCtx().createBuffer(numChannels, totalFrames, recSampleRateRef.current)
      for (let ch = 0; ch < numChannels; ch++) {
        const out = decoded.getChannelData(ch)
        let offset = 0
        for (const chunk of channels[ch]) {
          out.set(chunk, offset)
          offset += chunk.length
        }
      }
      // Voiceover input tends to come in quiet: no browser AGC (deliberately
      // disabled above — it tends to mangle audio-interface signal worse
      // than it helps) means whatever gain the input device/OS is set to is
      // exactly what lands here. Peak-normalize to a safe, consistent level
      // instead of leaving every recording too quiet against the timeline's
      // other tracks. Gain is capped so a near-silent take (wrong device,
      // muted mic) doesn't get amplified into audible noise floor.
      const TARGET_PEAK = 0.9
      const MAX_GAIN = 12
      let peak = 0
      for (let ch = 0; ch < numChannels; ch++) {
        const data = decoded.getChannelData(ch)
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
      }
      if (peak > 0) {
        const gain = Math.min(TARGET_PEAK / peak, MAX_GAIN)
        if (gain > 1.01) {
          for (let ch = 0; ch < numChannels; ch++) {
            const data = decoded.getChannelData(ch)
            for (let i = 0; i < data.length; i++) data[i] *= gain
          }
        }
      }
      // Capture is already raw PCM — reuse the same WAV encoder the old
      // MediaRecorder path used after its decode step, so everything
      // downstream (waveform, upload, backend ffmpeg) is unaffected by
      // how the audio was captured.
      const wavBlob = audioBufferToWavBlob(decoded)
      const filename = `voiceover-${Date.now()}.wav`
      const file = new File([wavBlob], filename, { type: 'audio/wav' })
      const key = crypto.randomUUID()
      setPeaksByKey(cur => ({ ...cur, [key]: computePeaks(decoded) }))
      setAudioTracks(cur => [...cur, {
        key, file, previewUrl: URL.createObjectURL(file), label: filename,
        offset: recordStartOffsetRef.current, duration: decoded.duration,
        trimStart: 0, trimEnd: decoded.duration, volume: 1,
      }])
      // Select it so it's unmissable — Properties panel updates and the
      // block gets an accent border, rather than a new track silently
      // appearing wherever it landed.
      setSelection({ kind: 'audio', key })
    } catch (e: unknown) {
      setRecordError('Could not process recording: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      recChannelsRef.current = []
    }
  }

  // Tab-switch or unmount mid-recording/mid-playback must not leak a live
  // mic stream or leave an animation-frame loop running.
  useEffect(() => {
    const audioEls = audioElRefs.current
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      if (recProcessorRef.current) { recProcessorRef.current.onaudioprocess = null; recProcessorRef.current.disconnect() }
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      for (const el of audioEls.values()) el.pause()
      sharedAudioCtxRef.current?.close()
    }
  }, [])

  // ── Browse Music (Jamendo) ────────────────────────────────────────────────
  async function searchMusic() {
    setMusicSearching(true); setMusicError('')
    try {
      const params = new URLSearchParams({ order: musicOrder })
      if (musicQuery.trim()) params.set('q', musicQuery.trim())
      if (musicTag) params.set('tags', musicTag)
      const r = await fetch(`/api/video/music/search?${params}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`)
      setMusicResults(data)
    } catch (e: unknown) {
      setMusicResults([])
      setMusicError(e instanceof Error ? e.message : String(e))
    } finally {
      setMusicSearching(false)
    }
  }

  function togglePreview(track: JamendoTrack) {
    const audio = previewAudioRef.current
    if (!audio) return
    if (playingTrackId === track.id) {
      audio.pause(); setPlayingTrackId(null); return
    }
    audio.src = `/api/video/music/proxy?url=${encodeURIComponent(track.audio_url)}`
    audio.play().catch(() => {})
    setPlayingTrackId(track.id)
  }

  async function applyMusicTrack(track: JamendoTrack) {
    setFetchingTrackId(track.id)
    try {
      const r = await fetch(`/api/video/music/proxy?url=${encodeURIComponent(track.audio_url)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      const filename = `${track.artist} - ${track.name}.mp3`
      const file = new File([blob], filename, { type: 'audio/mpeg' })
      const key = crypto.randomUUID()
      setAudioTracks(cur => [...cur, {
        key, file, previewUrl: URL.createObjectURL(file), label: filename,
        offset: 0, duration: null, trimStart: 0, trimEnd: null, volume: 0.3,
      }])
      setSelection({ kind: 'audio', key })
      previewAudioRef.current?.pause(); setPlayingTrackId(null)
      setShowMusicBrowser(false)
    } catch (e: unknown) {
      setMusicError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetchingTrackId(null)
    }
  }

  async function render() {
    const uploadClips = clips.filter(c => c.sourceType === 'upload')
    const timeline = clips.map(c => ({
      source_type: c.sourceType,
      source_id: c.sourceType === 'job' ? c.jobId! : String(uploadClips.indexOf(c)),
      trim_start: c.trimStart || null,
      trim_end: c.trimEnd,
      is_photo: c.isPhoto,
      look: c.look,
      speed: c.speed,
    }))

    const form = new FormData()
    form.append('timeline', JSON.stringify(timeline))
    for (const c of uploadClips) form.append('files', c.file!)
    form.append('canvas', canvas)
    form.append('transitions', JSON.stringify(transitions))

    const audioTracksPayload = audioTracks.map((t, i) => ({
      source_id: String(i), offset: t.offset,
      trim_start: t.trimStart || null, trim_end: t.trimEnd, volume: t.volume,
    }))
    form.append('audio_tracks', JSON.stringify(audioTracksPayload))
    for (const t of audioTracks) form.append('audio_files', t.file)
    form.append('mute_clip_audio', String(muteClipAudio))
    if (captions.length > 0) form.append('captions_srt', cuesToSrt(captions))

    await start('/api/video/edit/jobs', form)
  }

  const rendering = job.status === 'queued' || job.status === 'running'
  const layout = layoutOf(clips, pxPerSec)
  const audioLayout = audioLayoutOf(audioTracks, pxPerSec)
  const totalDur = totalDuration(clips, audioTracks, captions)
  const activeLook = clipAtTime(clips, playhead)?.clip.look ?? 'none'
  // The preview <video>/<img> has no text track of its own — captions only
  // get burned into the actual pixels at render time (backend subtitles
  // filter), so without this the caption row on the timeline had nothing
  // to show for itself until you rendered the whole thing.
  const activeCaption = captions.find(c => playhead >= c.start && playhead < c.end) ?? null
  const tickEvery = pxPerSec < 15 ? 5 : pxPerSec < 40 ? 2 : 1
  const ticks: number[] = []
  for (let t = 0; t <= totalDur + tickEvery; t += tickEvery) ticks.push(t)

  const selectedClip = selection?.kind === 'clip' ? clips.find(c => c.key === selection.key) ?? null : null
  const selectedAudio = selection?.kind === 'audio' ? audioTracks.find(t => t.key === selection.key) ?? null : null
  const selectedCaption = selection?.kind === 'caption' ? captions.find(c => c.key === selection.key) ?? null : null
  const downloadFilename = `arynwood-edit-${timestampSlug()}.mp4`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)' }}>
        <strong style={{ fontSize: 12 }}>{clips.length === 0 ? 'Start by importing media from the left.' : 'Project controls'}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, flex: 1 }}>Trim and arrange here, then add captions and generated shots when you need them.</span>
        {onOpenCaptions && <button onClick={onOpenCaptions} style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}><Captions size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Captions</button>}
        {onOpenGenerate && <button onClick={onOpenGenerate} style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid var(--accent)', background: 'rgba(124,110,247,.1)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}><Sparkles size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Generate shot</button>}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
        {/* ── Media Pool ── */}
        <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', paddingRight: 4 }}>
          <div>
            <span style={LABEL}>Add from Library</span>
            {library.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No generated clips yet — make something in the Generate tab first.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {library.map(item => (
                  <button
                    key={item.job_id} onClick={() => addFromLibrary(item)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11, cursor: 'pointer' }}
                  >
                    + {item.tool} ({new Date(item.created_at * 1000).toLocaleTimeString()})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setIsFileOver(true) }}
            onDragLeave={() => setIsFileOver(false)}
            onDrop={e => { e.preventDefault(); setIsFileOver(false); addUpload(e.dataTransfer.files) }}
            style={{ border: `1px dashed ${isFileOver ? 'var(--accent)' : 'var(--border)'}`, background: isFileOver ? 'rgba(124,110,247,0.06)' : 'transparent', borderRadius: 8, padding: '14px 16px' }}
          >
            <span style={LABEL}>Upload Clips & Photos</span>
            <input type="file" accept="video/*,image/*" multiple style={{ fontSize: 12, color: 'var(--text)', width: '100%' }} onChange={e => addUpload(e.target.files)} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>Drag files here or use the picker. A photo loops for however long you set it — drag its right edge to hold it longer.</p>
          </div>

          <div>
            <span style={LABEL}>Canvas</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CANVAS_OPTIONS.map(opt => (
                <button
                  key={opt.id} onClick={() => setCanvas(opt.id)}
                  style={{
                    padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    border: canvas === opt.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: canvas === opt.id ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                    color: canvas === opt.id ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Preview + Toolbar + Timeline ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ position: 'relative', width: 'auto', maxWidth: 300, height: 'auto', maxHeight: 220, aspectRatio: CANVAS_ASPECT[canvas], background: '#000', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <img ref={previewImgRef} style={{ width: '100%', height: '100%', objectFit: 'contain', display: previewShowsImage ? 'block' : 'none', filter: LOOK_CSS_FILTER[activeLook] }} />
                <video
                  ref={previewVideoRef} playsInline
                  onError={e => reportPreviewError('Video', (e.target as HTMLVideoElement).error)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: previewShowsImage ? 'none' : 'block', filter: LOOK_CSS_FILTER[activeLook] }}
                />
                {clips.length === 0 && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 12 }}>
                    {audioTracks.length > 0 ? 'Audio-only timeline' : 'Add clips to preview'}
                  </div>
                )}
                {activeCaption && (
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 10, display: 'flex', justifyContent: 'center', padding: '0 10px', pointerEvents: 'none' }}>
                    <span style={{ background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, textAlign: 'center', lineHeight: 1.3 }}>
                      {activeCaption.text}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <button
                  onClick={togglePlay}
                  title="Play/Pause (Space)"
                  style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(playhead)} / {fmtDuration(totalDur)}</span>
              </div>
              {previewError && (
                <p style={{ fontSize: 10, color: 'var(--danger)', maxWidth: 300, marginTop: 6 }}>{previewError}</p>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: 'var(--text-muted)', paddingTop: 4 }}>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--text)' }}>{clips.length}</strong> clip{clips.length === 1 ? '' : 's'} · <strong style={{ color: 'var(--text)' }}>{audioTracks.length}</strong> audio track{audioTracks.length === 1 ? '' : 's'} · {totalDur.toFixed(1)}s total</p>
              <p style={{ margin: 0 }}><kbd>Space</kbd> play/pause · <kbd>S</kbd> split at playhead · <kbd>Delete</kbd> removes selection</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={LABEL}>Timeline</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setSplitMode(s => !s)}
                title="Razor — click a clip to split it in two (or press S to split at the playhead)"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: splitMode ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: splitMode ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                  color: splitMode ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                <Scissors size={12} /> Split
              </button>
              <button
                onClick={() => setSnapEnabled(s => !s)}
                title="Snap to clip edges, other tracks, and the playhead while dragging"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: snapEnabled ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: snapEnabled ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                  color: snapEnabled ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                <Magnet size={12} /> Snap
              </button>
              <button onClick={() => setPxPerSec(z => Math.max(z - 10, 5))} style={{ width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>−</button>
              <button onClick={() => setPxPerSec(z => Math.min(z + 10, 200))} style={{ width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>+</button>
            </div>
          </div>

          {clips.length === 0 && audioTracks.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Add clips from the sidebar, then drag to reorder, drag clip edges to trim, or use Split to cut. Click the dot between two clips to add a transition. Click the ruler to scrub.</p>
          ) : (
            <div ref={trackRef} onClick={() => setSelection(null)} style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 8px' }}>
            <div style={{ position: 'relative', minWidth: Math.max(totalDur * pxPerSec, 100) }}>
              <div onMouseDown={onRulerMouseDown} style={{ position: 'relative', height: 18, cursor: 'pointer' }}>
                {ticks.map(t => (
                  <span key={t} style={{ position: 'absolute', left: t * pxPerSec, fontSize: 10, color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', paddingLeft: 3 }}>{t}s</span>
                ))}
              </div>

              {clips.length > 0 && (
                <div style={{ position: 'relative', marginTop: 4 }}>
                  <div style={{ display: 'flex', height: TRACK_HEIGHT }}>
                    {clips.map((c, i) => {
                      const w = layout[i].width
                      return (
                        <div
                          key={c.key}
                          onMouseDown={e => onBlockMouseDown(e, c)}
                          onClick={e => onBlockClick(e, c)}
                          style={{
                            width: w, height: '100%', position: 'relative', flexShrink: 0,
                            background: dragKey === c.key ? 'rgba(124,110,247,0.35)' : 'var(--surface2)',
                            border: selection?.kind === 'clip' && selection.key === c.key ? '2px solid var(--accent)' : '1px solid var(--border)',
                            borderRadius: 4, overflow: 'hidden', marginRight: 2,
                            cursor: splitMode ? 'crosshair' : dragKey === c.key ? 'grabbing' : 'grab',
                          }}
                        >
                          {c.isImage ? (
                            <img src={c.previewUrl} alt={c.label} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                          ) : (
                            <video src={c.previewUrl} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                          )}
                          <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: w - 8 }}>{c.label}</span>
                          <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 9, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
                            {c.trimStart.toFixed(1)}s–{effEnd(c).toFixed(1)}s
                          </span>
                          <div onMouseDown={e => onClipHandleMouseDown(e, c, 'start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: HANDLE_W, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }} />
                          <div onMouseDown={e => onClipHandleMouseDown(e, c, 'end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: HANDLE_W, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }} />
                          <button
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); remove(c.key) }}
                            style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', borderRadius: 3, width: 14, height: 14, lineHeight: '14px', padding: 0 }}
                          >✕</button>
                        </div>
                      )
                    })}
                  </div>
                  {transitions.map((t, i) => {
                    const boundaryX = layout[i].x + layout[i].width
                    return (
                      <button
                        key={i}
                        onClick={() => cycleTransition(i)}
                        title={`Transition: ${TRANSITION_LABEL[t.type]} — click to change`}
                        style={{
                          position: 'absolute', left: boundaryX - 9, top: TRACK_HEIGHT / 2 - 9,
                          width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', zIndex: 2,
                          fontSize: 9, lineHeight: '16px', padding: 0,
                          border: t.type === 'cut' ? '1px solid var(--border)' : '1px solid var(--accent)',
                          background: t.type === 'cut' ? 'var(--surface)' : 'var(--accent)',
                          color: t.type === 'cut' ? 'var(--text-muted)' : '#fff',
                        }}
                      >
                        {t.type === 'cut' ? '|' : '×'}
                      </button>
                    )
                  })}
                </div>
              )}

              {captions.length > 0 && (
                <div style={{ position: 'relative', height: CAPTION_HEIGHT, marginTop: 8 }}>
                  {captions.map(cue => {
                    const x = cue.start * pxPerSec
                    const w = Math.max((cue.end - cue.start) * pxPerSec, 20)
                    const isSelected = selection?.kind === 'caption' && selection.key === cue.key
                    return (
                      <div
                        key={cue.key}
                        onMouseDown={e => onCaptionBlockMouseDown(e, cue)}
                        onClick={e => { e.stopPropagation(); setSelection({ kind: 'caption', key: cue.key }) }}
                        title={cue.text}
                        style={{
                          position: 'absolute', left: x, width: w, height: '100%',
                          background: captionDragKey === cue.key ? 'rgba(124,110,247,0.35)' : 'var(--surface2)',
                          border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                          borderRadius: 4, overflow: 'hidden',
                          cursor: captionDragKey === cue.key ? 'grabbing' : 'grab',
                          display: 'flex', alignItems: 'center', padding: '0 5px',
                        }}
                      >
                        <span style={{ fontSize: 9, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{cue.text}</span>
                        <div onMouseDown={e => onCaptionHandleMouseDown(e, cue, 'start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: HANDLE_W, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }} />
                        <div onMouseDown={e => onCaptionHandleMouseDown(e, cue, 'end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: HANDLE_W, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }} />
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); removeCaption(cue.key) }}
                          style={{ position: 'absolute', top: 1, right: 1, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 9, cursor: 'pointer', borderRadius: 3, width: 12, height: 12, lineHeight: '12px', padding: 0 }}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
              )}

              {audioTracks.length > 0 && (
                <div ref={audioRowsRef} style={{ display: 'flex', flexDirection: 'column', gap: AUDIO_ROW_GAP, marginTop: 8 }}>
                  {audioTracks.map((t, i) => {
                    const w = audioLayout[i].width
                    const x = audioLayout[i].x
                    return (
                      <div key={t.key} style={{ position: 'relative', height: TRACK_HEIGHT }}>
                        <div
                          onMouseDown={e => onAudioBlockMouseDown(e, t)}
                          onClick={e => onAudioBlockClick(e, t)}
                          style={{
                            position: 'absolute', left: x, width: w, height: '100%',
                            background: audioDragKey === t.key ? 'rgba(124,110,247,0.35)' : 'var(--surface2)',
                            border: selection?.kind === 'audio' && selection.key === t.key ? '2px solid var(--accent)' : '1px solid var(--border)',
                            borderRadius: 4, overflow: 'hidden',
                            cursor: splitMode ? 'crosshair' : audioDragKey === t.key ? 'grabbing' : 'grab',
                          }}
                        >
                          <canvas
                            ref={el => { if (el) waveformCanvasRefs.current.set(t.key, el); else waveformCanvasRefs.current.delete(t.key) }}
                            style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
                          />
                          <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 10, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: Math.max(w - 8, 0) }}>{t.label}</span>
                          <div onMouseDown={e => onAudioHandleMouseDown(e, t, 'start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: HANDLE_W, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }} />
                          <div onMouseDown={e => onAudioHandleMouseDown(e, t, 'end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: HANDLE_W, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }} />
                          <button
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); removeAudioTrack(t.key) }}
                            style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', borderRadius: 3, width: 14, height: 14, lineHeight: '14px', padding: 0 }}
                          >✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div
                onMouseDown={onRulerMouseDown}
                style={{ position: 'absolute', left: playhead * pxPerSec - 1, top: 0, bottom: 0, width: 2, background: 'var(--accent)', cursor: 'col-resize', zIndex: 5 }}
              >
                <div style={{ position: 'absolute', top: -6, left: -5, width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)' }} />
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Properties (selection-contextual) + Audio/Transitions/Render ── */}
      <div style={{ display: 'flex', gap: 16, flexShrink: 0, maxHeight: 280, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ width: 300, flexShrink: 0, overflowY: 'auto' }}>
          <span style={LABEL}>Properties</span>
          {selectedClip ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedClip.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedClip.trimStart.toFixed(1)}s–{effEnd(selectedClip).toFixed(1)}s source · {effDur(selectedClip).toFixed(1)}s on timeline</div>

              <div>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Look</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {LOOK_PRESETS.map(look => (
                    <button
                      key={look.id}
                      onClick={() => updateClipLook(selectedClip.key, look.id)}
                      title={look.label}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px 3px 3px', borderRadius: 999, cursor: 'pointer',
                        border: selectedClip.look === look.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: selectedClip.look === look.id ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                      }}
                    >
                      <span style={{ width: 14, height: 14, borderRadius: '50%', background: look.swatch, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }} />
                      <span style={{ fontSize: 10, color: selectedClip.look === look.id ? 'var(--accent)' : 'var(--text-muted)' }}>{look.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {!selectedClip.isImage && (
                <div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Speed</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {SPEED_PRESETS.map(speed => (
                      <button
                        key={speed}
                        onClick={() => updateClipSpeed(selectedClip.key, speed)}
                        style={{
                          padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 10, fontWeight: 600,
                          border: selectedClip.speed === speed ? '1px solid var(--accent)' : '1px solid var(--border)',
                          background: selectedClip.speed === speed ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
                          color: selectedClip.speed === speed ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        {speed}×
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => remove(selectedClip.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)' }}
              >
                <Trash2 size={12} /> Remove clip
              </button>
            </div>
          ) : selectedAudio ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAudio.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedAudio.offset.toFixed(1)}s → {(selectedAudio.offset + audioEffDur(selectedAudio)).toFixed(1)}s on timeline</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Volume
                <input type="range" min={0} max={2} step={0.05} value={selectedAudio.volume} onChange={e => updateAudioTrackVolume(selectedAudio.key, Number(e.target.value))} style={{ width: 110 }} />
                {(selectedAudio.volume * 100).toFixed(0)}%
              </label>
              <button
                onClick={() => removeAudioTrack(selectedAudio.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)' }}
              >
                <Trash2 size={12} /> Remove track
              </button>
            </div>
          ) : selectedCaption ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedCaption.start.toFixed(1)}s → {selectedCaption.end.toFixed(1)}s on timeline</div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                Caption text
                <textarea
                  value={selectedCaption.text}
                  onChange={e => updateCaptionText(selectedCaption.key, e.target.value)}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </label>
              <button
                onClick={() => removeCaption(selectedCaption.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)' }}
              >
                <Trash2 size={12} /> Remove caption
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select a clip, audio track, or caption to edit it.</p>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <span style={LABEL}>Audio</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={muteClipAudio} onChange={e => setMuteClipAudio(e.target.checked)} />
          Mute original clip audio (only the tracks below will play)
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <input
            type="file" accept="audio/*" style={{ fontSize: 12, color: 'var(--text)' }}
            onChange={e => { addAudioFile(e.target.files); e.target.value = '' }}
          />
          <button
            onClick={() => setShowMusicBrowser(s => !s)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              border: showMusicBrowser ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: showMusicBrowser ? 'rgba(124,110,247,0.12)' : 'var(--surface)',
              color: showMusicBrowser ? 'var(--accent)' : 'var(--text)',
            }}
          >
            🎵 Browse Free Music
          </button>
          <select
            value={micDeviceId} disabled={recording} onFocus={refreshMicDevices}
            onChange={e => setMicDeviceId(e.target.value)}
            title="Microphone to record from"
            style={{ padding: '5px 8px', borderRadius: 6, fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', maxWidth: 160 }}
          >
            {micDevices.length === 0 && <option value="">Default microphone</option>}
            {micDevices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </select>
          <button
            onClick={recording ? stopVoiceoverRecording : startVoiceoverRecording}
            disabled={rendering || micRequesting}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              cursor: rendering || micRequesting ? 'not-allowed' : 'pointer', border: 'none',
              background: recording ? 'var(--danger)' : 'var(--accent)', color: '#fff', opacity: rendering || micRequesting ? 0.5 : 1,
            }}
          >
            {recording ? <Square size={12} /> : <Mic size={12} />}
            {recording ? `Stop Recording (${fmtDuration(recordElapsed)})` : micRequesting ? 'Requesting mic access…' : 'Record Voiceover'}
          </button>
          {recording && (
            <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(recordLevel * 220, 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 60ms linear' }} />
            </div>
          )}
        </div>

        {recordError && (
          <div style={{ fontSize: 11, color: 'var(--danger)', background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 6, padding: '8px 10px', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            {recordError}
          </div>
        )}

        {showMusicBrowser && (
          <div style={{ marginBottom: 10, padding: 12, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <input
                type="text" placeholder="Search tracks…" value={musicQuery}
                onChange={e => setMusicQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchMusic() }}
                style={{ flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}
              />
              <select value={musicTag} onChange={e => setMusicTag(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}>
                {JAMENDO_TAGS.map(t => <option key={t} value={t}>{t ? t[0].toUpperCase() + t.slice(1) : 'Any genre'}</option>)}
              </select>
              <select value={musicOrder} onChange={e => setMusicOrder(e.target.value as typeof musicOrder)} style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}>
                <option value="popularity_total">Popular</option>
                <option value="releasedate">Newest</option>
              </select>
              <button
                onClick={searchMusic} disabled={musicSearching}
                style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: musicSearching ? 'wait' : 'pointer', border: 'none', background: 'var(--accent)', color: '#fff' }}
              >
                {musicSearching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {musicError && (
              <div style={{ fontSize: 11, color: 'var(--danger)', background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 6, padding: '8px 10px', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                {musicError}
              </div>
            )}

            {musicResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {musicResults.map(track => (
                  <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px' }}>
                    <button
                      onClick={() => togglePreview(track)}
                      title="Preview"
                      style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 10 }}
                    >
                      {playingTrackId === track.id ? '⏸' : '▶'}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{track.artist} · {fmtDuration(track.duration)}</div>
                    </div>
                    <button
                      onClick={() => applyMusicTrack(track)} disabled={fetchingTrackId === track.id}
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: fetchingTrackId === track.id ? 'wait' : 'pointer', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', flexShrink: 0 }}
                    >
                      {fetchingTrackId === track.id ? 'Loading…' : 'Use This Track'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <audio ref={previewAudioRef} onEnded={() => setPlayingTrackId(null)} style={{ display: 'none' }} />
          </div>
        )}

        {audioTracks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={LABEL}>Track Details</span>
            {audioTracks.map(track => (
              <div key={track.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ minWidth: 140, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.label}</span>
                <span>{track.offset.toFixed(1)}s → {(track.offset + audioEffDur(track)).toFixed(1)}s</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Vol
                  <input type="range" min={0} max={2} step={0.05} value={track.volume} onChange={e => updateAudioTrackVolume(track.key, Number(e.target.value))} style={{ width: 90 }} />
                  {(track.volume * 100).toFixed(0)}%
                </label>
                <button onClick={() => removeAudioTrack(track.key)} style={{ fontSize: 11, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {transitions.some(t => t.type !== 'cut') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            <span style={LABEL}>Transitions</span>
            {transitions.map((t, i) => t.type !== 'cut' && (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>Clip {i + 1} → {i + 2}: <strong style={{ color: 'var(--text)' }}>{TRANSITION_LABEL[t.type]}</strong></span>
                <input
                  type="number" min={0.1} max={3} step={0.1} value={t.duration}
                  onChange={e => updateTransitionDuration(i, Number(e.target.value))}
                  style={{ width: 56, padding: '3px 6px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 11 }}
                />
                <span>s</span>
              </div>
            ))}
          </div>
        )}
        </div>

        <div style={{ flexShrink: 0, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={render} disabled={clips.length === 0 || rendering || recording}
            style={{
              padding: '10px 24px', borderRadius: 8, fontWeight: 600, fontSize: 13, alignSelf: 'flex-start',
              background: clips.length === 0 || rendering || recording ? 'var(--surface2)' : 'var(--accent)', color: '#fff', border: 'none',
              cursor: clips.length === 0 || rendering || recording ? 'not-allowed' : 'pointer', opacity: clips.length === 0 || rendering || recording ? 0.5 : 1,
            }}
          >
            {rendering ? `${job.status === 'queued' ? 'Queued' : 'Rendering'}…` : 'Render Timeline'}
          </button>

          {job.status === 'error' && (
            <div style={{ background: 'rgba(224,82,82,0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>
              <strong>Render failed</strong><br />{job.error}
            </div>
          )}

          {job.status === 'done' && job.resultPath && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={LABEL}>Result</span>
              <video src={job.resultPath} controls style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
              <div style={{ display: 'flex', gap: 12 }}>
                <a href={`/api/tools/jobs/${job.jobId}/download/${encodeURIComponent(downloadFilename)}`} download={downloadFilename} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>↓ Download</a>
                <button onClick={reset} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Start a new render</button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

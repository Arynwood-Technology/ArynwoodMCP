import { create } from 'zustand'

// The Video Studio Editor's actual project data — everything a person would
// be upset to lose. Lives in a Zustand store (not component useState) so it
// survives navigating to a different page and back; previously it was pure
// local state in TimelineEditor and any route change silently discarded the
// whole timeline. Purely transient interaction state (drag-in-progress,
// scrub position, recording level meters, music-search UI, etc.) stays as
// local useState in TimelineEditor — none of that is meaningful to "resume"
// after a remount, and moving it here would just add risk for no benefit.

export interface Clip {
  key: string
  sourceType: 'job' | 'upload'
  jobId?: string
  file?: File
  label: string
  previewUrl: string
  isImage: boolean          // gif or photo — rendered via <img>, not <video> (video tag can't play either)
  isPhoto: boolean          // static image only (not gif) — no intrinsic duration, backend loops it to fill the trim
  duration: number | null   // total source duration once known (via <video> metadata) — never set for isImage clips
  trimStart: number
  trimEnd: number | null    // null = "to end of clip"
  look: LookId               // per-clip cinematic color grade, applied server-side
  speed: number               // playback rate, source trim stays in source time — only meaningful for real video (not isImage)
}

export type LookId = 'none' | 'cinematic' | 'teal_orange' | 'golden_hour' | 'noir' | 'bleach_bypass' | 'vintage_film' | 'dreamy' | 'cyberpunk'

export type TransitionType = 'cut' | 'fade' | 'slideleft' | 'slideup'
export interface Transition { type: TransitionType; duration: number }

export type Canvas = 'vertical' | 'square' | 'landscape' | 'auto'

// A single audio layer positioned on the timeline (background music, a
// recorded voiceover, etc.) — any number can play back simultaneously,
// independently dragged/trimmed/volumed, and are mixed together at render.
export interface AudioTrack {
  key: string
  file: File
  previewUrl: string
  label: string
  offset: number             // seconds from timeline start — draggable
  duration: number | null    // resolved async via decodeAudioData
  trimStart: number
  trimEnd: number | null     // null = to end of source
  volume: number              // 0-1
}

// A single subtitle cue on the caption row — unlike clips/audio there's no
// underlying source media, so start/end ARE the on-timeline position
// directly (no separate source-vs-timeline distinction to track).
export interface CaptionCue {
  key: string
  start: number
  end: number
  text: string
}

interface VideoEditorStore {
  clips: Clip[]
  setClips: (updater: Clip[] | ((cur: Clip[]) => Clip[])) => void

  transitions: Transition[]
  setTransitions: (updater: Transition[] | ((cur: Transition[]) => Transition[])) => void

  canvas: Canvas
  setCanvas: (c: Canvas) => void

  audioTracks: AudioTrack[]
  setAudioTracks: (updater: AudioTrack[] | ((cur: AudioTrack[]) => AudioTrack[])) => void

  muteClipAudio: boolean
  setMuteClipAudio: (v: boolean) => void

  captions: CaptionCue[]
  setCaptions: (updater: CaptionCue[] | ((cur: CaptionCue[]) => CaptionCue[])) => void

  peaksByKey: Record<string, Float32Array>
  setPeaksByKey: (updater: Record<string, Float32Array> | ((cur: Record<string, Float32Array>) => Record<string, Float32Array>)) => void

  pxPerSec: number
  setPxPerSec: (updater: number | ((cur: number) => number)) => void

  snapEnabled: boolean
  setSnapEnabled: (updater: boolean | ((cur: boolean) => boolean)) => void
}

export const useVideoEditorStore = create<VideoEditorStore>((set, get) => ({
  clips: [],
  setClips: (updater) => set({ clips: typeof updater === 'function' ? updater(get().clips) : updater }),

  transitions: [],
  setTransitions: (updater) => set({ transitions: typeof updater === 'function' ? updater(get().transitions) : updater }),

  canvas: 'landscape',
  setCanvas: (canvas) => set({ canvas }),

  audioTracks: [],
  setAudioTracks: (updater) => set({ audioTracks: typeof updater === 'function' ? updater(get().audioTracks) : updater }),

  muteClipAudio: false,
  setMuteClipAudio: (muteClipAudio) => set({ muteClipAudio }),

  captions: [],
  setCaptions: (updater) => set({ captions: typeof updater === 'function' ? updater(get().captions) : updater }),

  peaksByKey: {},
  setPeaksByKey: (updater) => set({ peaksByKey: typeof updater === 'function' ? updater(get().peaksByKey) : updater }),

  pxPerSec: 30,
  setPxPerSec: (updater) => set({ pxPerSec: typeof updater === 'function' ? updater(get().pxPerSec) : updater }),

  snapEnabled: true,
  setSnapEnabled: (updater) => set({ snapEnabled: typeof updater === 'function' ? updater(get().snapEnabled) : updater }),
}))

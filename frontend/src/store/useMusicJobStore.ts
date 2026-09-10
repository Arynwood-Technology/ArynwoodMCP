import { create } from 'zustand'

export type MusicJobStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface MusicJobState {
  status: MusicJobStatus
  jobId: string | null
  progress: number
  resultAssetId: string | null
  error: string | null
}

export const IDLE_MUSIC_JOB: MusicJobState = {
  status: 'idle', jobId: null, progress: 0, resultAssetId: null, error: null,
}

interface MusicJobStore {
  jobs: Record<string, MusicJobState>
  patchJob: (jobId: string, patch: Partial<MusicJobState>) => void
  removeJob: (jobId: string) => void
}

// Keyed by jobId itself, not a fixed panel slot like useVideoJobStore's
// ('generate' | 'render' | 'captions') — the Instrument Generator lets you
// queue up several ideas at once ("Bass Idea 01/02/03"), so more than one
// generation can legitimately be in flight from the same panel. The poll
// interval itself lives outside React, in useMusicJobPoll.ts, so a job
// started here keeps running (and lands here) even after navigating away
// from the Generate/Jam tab and back.
export const useMusicJobStore = create<MusicJobStore>((set) => ({
  jobs: {},
  patchJob: (jobId, patch) => set(state => ({
    jobs: { ...state.jobs, [jobId]: { ...(state.jobs[jobId] ?? IDLE_MUSIC_JOB), ...patch } },
  })),
  removeJob: (jobId) => set(state => {
    const next = { ...state.jobs }
    delete next[jobId]
    return { jobs: next }
  }),
}))

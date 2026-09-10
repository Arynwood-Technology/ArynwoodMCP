import { create } from 'zustand'

export type JobStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface JobState {
  status: JobStatus
  jobId: string | null
  resultPath: string | null
  resultText: string | null
  error: string | null
}

export const IDLE_JOB: JobState = { status: 'idle', jobId: null, resultPath: null, resultText: null, error: null }

interface VideoJobStore {
  jobs: Record<string, JobState>
  patchJob: (key: string, patch: Partial<JobState>) => void
  setJob: (key: string, job: JobState) => void
}

// Keyed by job "slot" (one per panel: 'generate', 'render', 'captions') so each
// panel's in-flight job survives navigating to a different page and back —
// the poll interval itself lives outside React entirely (see useJobPoll.ts),
// this store just holds the last-known status each interval reports.
export const useVideoJobStore = create<VideoJobStore>((set) => ({
  jobs: {},
  patchJob: (key, patch) => set(state => ({
    jobs: { ...state.jobs, [key]: { ...(state.jobs[key] ?? IDLE_JOB), ...patch } },
  })),
  setJob: (key, job) => set(state => ({ jobs: { ...state.jobs, [key]: job } })),
}))

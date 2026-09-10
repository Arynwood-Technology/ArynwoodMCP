import { create } from 'zustand'

// 'saving'/'saved' extend the raw job lifecycle ('queued'|'running'|'done'|'error')
// with the follow-on POST /learn call — the whole parse-then-save pipeline is one
// piece of state so it can't be double-submitted on remount (see useKnowledgeJobPoll).
export type KnowledgeJobStatus = 'idle' | 'queued' | 'running' | 'saving' | 'saved' | 'error'

export interface KnowledgeJobState {
  status: KnowledgeJobStatus
  jobId: string | null
  filename: string | null
  startedAt: number | null
  savedTitle: string | null
  savedChunks: number | null
  error: string | null
}

export const IDLE_KNOWLEDGE_JOB: KnowledgeJobState = {
  status: 'idle', jobId: null, filename: null, startedAt: null,
  savedTitle: null, savedChunks: null, error: null,
}

interface KnowledgeJobStore {
  job: KnowledgeJobState
  patchJob: (patch: Partial<KnowledgeJobState>) => void
}

// A single slot, not keyed like useVideoJobStore — Knowledge only ever has one PDF
// parse in flight at a time. Surviving navigation is the whole point: the poll
// interval lives outside React (see useKnowledgeJobPoll.ts) so a parse started on
// this page keeps running, and lands here, even if the user leaves and comes back.
export const useKnowledgeJobStore = create<KnowledgeJobStore>((set) => ({
  job: IDLE_KNOWLEDGE_JOB,
  patchJob: (patch) => set(state => ({ job: { ...state.job, ...patch } })),
}))

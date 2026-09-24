// Generic queued/running/done/error job simulation, shared by every demo-mode route that
// mimics the real backend's job-start-then-poll pattern (music generate/jam, stem
// separation, voice conversion, Chatterbox TTS). Each feature's own route handler
// translates the generic phase into that endpoint's real status vocabulary — this module
// only tracks elapsed time and whether the real (synchronous, awaited immediately) work
// has settled.
export type JobPhase = 'queued' | 'running' | 'done' | 'error'

interface SimJob {
  startedAt: number
  minDurationMs: number
  settled: boolean
  ok: boolean
  error?: string
}

const jobs = new Map<string, SimJob>()
let counter = 0

export function mintJobId(prefix: string): string {
  return `demo-${prefix}-${Date.now().toString(36)}-${++counter}`
}

/**
 * Registers `id` as queued and immediately kicks off `work(id)` — the real synthesis/DSP
 * call. `work` receives its own id so it can register results (registerDemoAudio,
 * musicAssetStore, ...) under that same key before resolving. `minDurationMs` gates when
 * pollJob starts reporting 'done' even if `work` resolves faster, so the UI's progress bar
 * gets a few genuine polls to animate through instead of jumping straight to 100%.
 */
export function startJob(id: string, minDurationMs: number, work: (id: string) => Promise<void>): void {
  jobs.set(id, { startedAt: Date.now(), minDurationMs, settled: false, ok: false })
  work(id)
    .then(() => {
      const j = jobs.get(id)
      if (j) { j.ok = true; j.settled = true }
    })
    .catch((e: unknown) => {
      const j = jobs.get(id)
      if (j) { j.ok = false; j.error = e instanceof Error ? e.message : 'Demo processing failed'; j.settled = true }
    })
}

export function pollJob(id: string): { phase: JobPhase; progress: number; error?: string } | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  const elapsed = Date.now() - job.startedAt
  const ready = job.settled && elapsed >= job.minDurationMs
  const phase: JobPhase = ready ? (job.ok ? 'done' : 'error') : 'running'
  const progress = phase === 'done' ? 100 : Math.min(96, Math.round((elapsed / job.minDurationMs) * 100))
  return { phase, progress, error: job.error }
}

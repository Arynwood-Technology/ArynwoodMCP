import { apiUrl } from '../../lib/api'
import { useCallback } from 'react'
import { useVideoJobStore, IDLE_JOB } from '../../store/useVideoJobStore'

// The poll interval lives in module scope, not a component ref — a ref dies
// with its component, and navigating away from the Video Studio page used to
// silently orphan the interval: the job would finish server-side, the poll
// would notice, and then call a state setter for a component that no longer
// existed. Keeping it here means the interval (and the job store it writes
// to) survive regardless of which component is or isn't mounted.
const pollIntervals = new Map<string, ReturnType<typeof setInterval>>()

/** Starts a job against any /api/tools/*jobs or /api/video/*jobs endpoint and
 * polls the shared GET /api/tools/jobs/{id} until done/error. Every job type
 * in this app (SadTalker/AnimateDiff/LTX-Video/Wan2.1/edit/captions) shares
 * the same backend job dict, so one poller works for all of them — avoids
 * re-copy-pasting the polling loop into each panel.
 *
 * `key` identifies which panel's job slot this is ('generate' | 'render' |
 * 'captions') — each is tracked independently in useVideoJobStore so it
 * survives navigating to a different page and back. */
export function useJobPoll(key: string) {
  const job = useVideoJobStore(s => s.jobs[key] ?? IDLE_JOB)
  const patchJob = useVideoJobStore(s => s.patchJob)

  const stopPolling = useCallback(() => {
    const handle = pollIntervals.get(key)
    if (handle) { clearInterval(handle); pollIntervals.delete(key) }
  }, [key])

  const start = useCallback(async (startUrl: string, body: FormData) => {
    stopPolling()
    patchJob(key, { ...IDLE_JOB, status: 'queued' })
    try {
      const r = await fetch(startUrl, { method: 'POST', body })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`)
      const jobId = data.job_id as string
      patchJob(key, { jobId })

      const handle = setInterval(async () => {
        try {
          const jr = await fetch(`/api/tools/jobs/${jobId}`)
          const j = await jr.json()
          if (j.status === 'done') {
            stopPolling()
            patchJob(key, {
              status: 'done', jobId,
              resultPath: j.result_path ? apiUrl(`/api/tools/jobs/${jobId}/file`) : null,
              resultText: j.result_text ?? null, error: null,
            })
          } else if (j.status === 'error') {
            stopPolling()
            patchJob(key, { status: 'error', jobId, resultPath: null, resultText: null, error: j.error || 'Job failed' })
          } else {
            patchJob(key, { status: j.status })
          }
        } catch { /* transient poll failure, keep trying */ }
      }, 3000)
      pollIntervals.set(key, handle)
    } catch (e: unknown) {
      patchJob(key, { ...IDLE_JOB, status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [key, patchJob, stopPolling])

  const reset = useCallback(() => { stopPolling(); patchJob(key, IDLE_JOB) }, [key, patchJob, stopPolling])

  return { job, start, reset }
}

import { useCallback } from 'react'
import { useMusicJobStore, IDLE_MUSIC_JOB } from '../../store/useMusicJobStore'

// Module scope, not a component ref — see video/useJobPoll.ts's identical
// reasoning: navigating away from the Generate/Jam tab must not orphan the
// interval mid-poll.
const pollIntervals = new Map<string, ReturnType<typeof setInterval>>()

/** The backend's own explanation for a rejected request — FastAPI's `detail` is a string, or a list of field errors on a 422. */
export function describeStartFailure(status: number, data: unknown): string {
  const detail = (data as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail.map(d => {
      const item = d as { loc?: unknown[]; msg?: string }
      const field = Array.isArray(item.loc) ? item.loc.filter(p => p !== 'body').join('.') : ''
      return field ? `${field}: ${item.msg ?? 'invalid'}` : (item.msg ?? 'invalid')
    }).join('; ')
  }
  return `The server rejected the request (HTTP ${status}).`
}

export type StartResult = { jobId: string } | { error: string }

/** Starts a job against POST /api/music/generate (or /jam, /stems) and polls
 * GET /api/music/jobs/{id} until done/error. This is a separate, DB-backed
 * job registry (music_generation_jobs) from /api/tools/jobs, so it can't
 * reuse video's useJobPoll — status vocabulary and the queue endpoint both
 * differ. Returns the new job's id so the caller can read its live state via
 * `useMusicJobStore(s => s.jobs[jobId])`, or the reason if the initial POST
 * itself failed (network error, 4xx) — that has no job_id yet, so it's surfaced
 * to the caller directly rather than inventing a fake store entry for it. */
export function useMusicJobPoll() {
  const patchJob = useMusicJobStore(s => s.patchJob)

  const stopPolling = useCallback((jobId: string) => {
    const handle = pollIntervals.get(jobId)
    if (handle) { clearInterval(handle); pollIntervals.delete(jobId) }
  }, [])

  const start = useCallback(async (startUrl: string, body: FormData): Promise<StartResult> => {
    try {
      const r = await fetch(startUrl, { method: 'POST', body })
      const data = await r.json().catch(() => null)
      if (!r.ok) return { error: describeStartFailure(r.status, data) }
      const jobId = data?.job_id as string | undefined
      if (!jobId) return { error: 'The server accepted the request but did not return a job id.' }
      patchJob(jobId, { ...IDLE_MUSIC_JOB, jobId, status: 'queued' })

      const handle = setInterval(async () => {
        try {
          const jr = await fetch(`/api/music/jobs/${jobId}`)
          const j = await jr.json()
          if (j.status === 'done') {
            stopPolling(jobId)
            patchJob(jobId, { status: 'done', progress: 100, resultAssetId: j.result_asset_id ?? null, error: null })
          } else if (j.status === 'error') {
            stopPolling(jobId)
            patchJob(jobId, { status: 'error', error: j.error || 'Job failed' })
          } else {
            patchJob(jobId, { status: j.status, progress: j.progress ?? 0 })
          }
        } catch { /* transient poll failure, keep trying */ }
      }, 2000)
      pollIntervals.set(jobId, handle)
      return { jobId }
    } catch {
      return { error: 'Could not reach the Arynwood backend. Is it still running?' }
    }
  }, [patchJob, stopPolling])

  return { start, stopPolling }
}

import { useCallback } from 'react'
import { useKnowledgeJobStore, IDLE_KNOWLEDGE_JOB } from '../store/useKnowledgeJobStore'
import { startSycamorePartitionJob, getKnowledgeJob, learnChunks, learnFile } from '../lib/api'

// Module scope, not a component ref — same reasoning as components/video/useJobPoll.ts:
// a ref dies with its component, and navigating away from Knowledge mid-parse used to
// silently orphan the interval. Keeping it here means the interval (and the save-to-KB
// step it triggers on completion) survive regardless of which component is mounted.
let pollHandle: ReturnType<typeof setInterval> | null = null

/** Starts a Sycamore PDF-parse job and polls it to completion, then immediately saves
 * the result to the knowledge base (chunks if Sycamore produced page/table-aware ones,
 * else the flattened text) — all inside the same module-scope interval callback, so a
 * completed job can only ever be saved once even if the page unmounts and remounts
 * mid-flight. See useKnowledgeJobStore for the persisted state this reads/writes. */
export function useKnowledgeJobPoll() {
  const job = useKnowledgeJobStore(s => s.job)
  const patchJob = useKnowledgeJobStore(s => s.patchJob)

  const stopPolling = useCallback(() => {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null }
  }, [])

  const start = useCallback(async (file: File, ocr: boolean) => {
    stopPolling()
    patchJob({ ...IDLE_KNOWLEDGE_JOB, status: 'queued', filename: file.name, startedAt: Date.now() })
    try {
      const { job_id } = await startSycamorePartitionJob(file, ocr)
      patchJob({ jobId: job_id })

      pollHandle = setInterval(async () => {
        try {
          const j = await getKnowledgeJob(job_id)
          if (j.status === 'done') {
            stopPolling()  // clear first — the save below must run exactly once
            patchJob({ status: 'saving' })
            try {
              const result = j.result_chunks?.length
                ? await learnChunks(file.name, j.result_chunks)
                : await learnFile(file.name, j.result_text || '')
              patchJob({ status: 'saved', savedTitle: result.title, savedChunks: result.chunks })
            } catch (e) {
              patchJob({ status: 'error', error: e instanceof Error ? e.message : 'Failed to save to knowledge base' })
            }
          } else if (j.status === 'error') {
            stopPolling()
            patchJob({ status: 'error', error: j.error || 'PDF parsing failed' })
          } else {
            patchJob({ status: j.status })
          }
        } catch { /* transient poll failure, keep trying */ }
      }, 3000)
    } catch (e) {
      patchJob({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }, [patchJob, stopPolling])

  const reset = useCallback(() => { stopPolling(); patchJob(IDLE_KNOWLEDGE_JOB) }, [patchJob, stopPolling])

  return { job, start, reset }
}

import { X } from 'lucide-react'
import { useMusicJobStore } from '../../store/useMusicJobStore'

/**
 * Jobs of yours that started and then failed inside the sidecar (a model crash, audio it couldn't decode…).
 * They used to just drop out of the "Generating" list with no trace, which looks exactly like nothing happening.
 */
export function FailedMusicJobs({ jobIds, onDismiss }: { jobIds: string[]; onDismiss: (jobId: string) => void }) {
  const jobs = useMusicJobStore(s => s.jobs)
  const removeJob = useMusicJobStore(s => s.removeJob)
  const failed = jobIds.filter(id => jobs[id]?.status === 'error')
  if (!failed.length) return null
  return (
    <>
      {failed.map(id => (
        <div key={id} role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', border: '1px solid var(--danger)', borderRadius: 8, color: 'var(--danger)', fontSize: 12, background: 'rgba(239,68,68,.08)' }}>
          <span style={{ flex: 1, lineHeight: 1.5, wordBreak: 'break-word' }}>Generation failed — {jobs[id]?.error || 'the sidecar reported an error.'}</span>
          <button aria-label="Dismiss" title="Dismiss" onClick={() => { removeJob(id); onDismiss(id) }}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </>
  )
}

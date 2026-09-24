import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Play, Square, Users } from 'lucide-react'
import { Button, PageBody, PageShell, SectionCard } from '../components/ui'
import {
  getCommunityStatus, openCommunity, startCommunity, stopCommunity, type CommunityStatus,
} from '../lib/api'
import { cn } from '../lib/cn'

const STATE_TEXT: Record<CommunityStatus['status'], string> = {
  running: 'Running', starting: 'Starting…', stopped: 'Stopped', failed: 'Failed to start', unreachable: 'Unreachable',
}
const STATE_DOT: Record<CommunityStatus['status'], string> = {
  running: 'bg-success', starting: 'bg-warning', stopped: 'bg-muted', failed: 'bg-danger', unreachable: 'bg-danger',
}

/** request() throws the response body; show FastAPI's `detail` rather than raw JSON. */
function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  try { return JSON.parse(text).detail ?? text } catch { return text }
}

export function Community() {
  const [status, setStatus] = useState<CommunityStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    getCommunityStatus()
      .then(s => { setStatus(s); setLoadError('') })
      .catch(err => setLoadError(errorText(err)))
  }, [])

  // Poll faster while it's coming up so "Starting…" turns into "Running" promptly.
  const starting = status?.status === 'starting'
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, starting ? 1500 : 8000)
    return () => clearInterval(id)
  }, [refresh, starting])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError('')
    try { await action() } catch (err) { setActionError(errorText(err)) }
    setBusy(false)
    refresh()
  }

  const open = (target: 'app' | 'repo') => run(async () => {
    const fallback = target === 'app' ? status?.url : status?.repo_url
    try { await openCommunity(target) } catch { window.open(fallback, '_blank', 'noopener') }
  })

  return (
    <PageShell>
      <PageBody>
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <p className="m-0 text-xs text-muted">
            Arynwood Community is a separate app: a private space for your people's messages, plans, household work,
            lists and notes. Arynwood MCP can start it on this computer and open it — it keeps running for your
            members when you close Arynwood MCP.
          </p>

          {loadError && <p role="alert" className="m-0 text-xs text-danger">Couldn't check Community: {loadError}</p>}

          {status && (
            <SectionCard
              title={<span className="flex items-center gap-2"><Users size={14} aria-hidden="true" /> {status.label}</span>}
              actions={
                <span className="flex items-center gap-1.5 text-[11px] text-muted" role="status">
                  <span aria-hidden="true" className={cn('size-2 rounded-full', STATE_DOT[status.status])} />
                  {STATE_TEXT[status.status]}{status.version ? ` · v${status.version}` : ''}
                </span>
              }
            >
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted">Address</dt>
                <dd className="m-0 break-all text-text">{status.url}</dd>
                <dt className="text-muted">Source</dt>
                <dd className="m-0">
                  {/* TODO(community-repo): repo_url is a placeholder until the official repo exists. */}
                  <button type="button" onClick={() => open('repo')}
                    className="cursor-pointer break-all border-none bg-transparent p-0 text-left text-accent hover:underline">
                    {status.repo_url.replace(/^https:\/\//, '')}
                  </button>
                </dd>
                {status.mode === 'local' ? (
                  <>
                    <dt className="text-muted">Local copy</dt>
                    <dd className="m-0 break-all text-text">{status.dir}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted">Hosting</dt>
                    <dd className="m-0 text-text">Hosted elsewhere — started and stopped on its server, not here.</dd>
                  </>
                )}
              </dl>

              {status.mode === 'local' && status.installed === false && (
                <p className="mb-0 mt-3 text-xs text-muted">
                  Community isn't installed there yet. Clone the Source repo into that folder (or set
                  <code className="mx-1 text-text">ARYNWOOD_COMMUNITY_DIR</code>
                  in <code className="text-text">.env</code> to where your copy lives), then run its setup.
                </p>
              )}
              {status.setup_missing.length > 0 && (
                <p className="mb-0 mt-3 text-xs text-muted">
                  Community needs its one-time setup before it can start. In a terminal:
                  <code className="mt-1.5 block rounded border border-border bg-surface2 px-2 py-1.5 font-mono text-[11px] text-text">
                    cd {status.dir} && ./setup.sh
                  </code>
                </p>
              )}
              {status.status === 'running' && !status.managed && status.mode === 'local' && (
                <p className="mb-0 mt-3 text-xs text-muted">Started outside Arynwood MCP, so stop it where it was started.</p>
              )}
              {status.status === 'failed' && status.error && (
                <pre className="mb-0 mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface2 p-2 text-[11px] text-danger">
                  {status.error}
                </pre>
              )}
              {actionError && <p role="alert" className="mb-0 mt-3 text-xs text-danger">{actionError}</p>}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => open('app')} disabled={busy || status.status !== 'running'}>
                  <ExternalLink size={13} aria-hidden="true" /> Open Community
                </Button>
                {status.can_start && (
                  <Button onClick={() => run(startCommunity)} disabled={busy}>
                    <Play size={13} aria-hidden="true" /> Start
                  </Button>
                )}
                {status.can_stop && (
                  <Button variant="outline" onClick={() => run(stopCommunity)} disabled={busy}>
                    <Square size={12} aria-hidden="true" /> Stop
                  </Button>
                )}
              </div>
            </SectionCard>
          )}

          {status?.mode === 'local' && (
            <p className="m-0 text-[11px] text-muted">
              To let members outside this computer in, host Community behind HTTPS (see its README), then set
              <code className="mx-1 text-text">ARYNWOOD_COMMUNITY_URL</code>
              to its public address so this page tracks the hosted copy instead.
            </p>
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}

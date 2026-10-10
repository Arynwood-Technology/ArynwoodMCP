import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Play, Square, Users } from 'lucide-react'
import { Button, SectionCard } from '../components/ui'
import {
  getCommunityStatus, openCommunity, setCommunityAddress, startCommunity, stopCommunity, type CommunityStatus,
} from '../lib/api'
import { cn } from '../lib/cn'
import { Community as GroveCommunity } from '../community/Community'
import { GroveContext, type GroveInfo } from '../community/lib/grove'
import { ircDisconnect } from '../community/lib/irc-manager'
import { useAppStore as useCommunityStore } from '../community/store/useAppStore'

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

const host = (url: string) => { try { return new URL(url).host } catch { return url } }

/** Leaving a Grove: its IRC connection and chat state live outside the page, so end them as Grove's sign-out does. */
function leaveGrove() {
  ircDisconnect()
  useCommunityStore.setState(useCommunityStore.getInitialState(), true)
}

/**
 * Community: the spaces, calendars, tasks and discussions on a Grove, shown inside Arynwood. The Grove is
 * one on this computer (Arynwood can start it) or one on a server; the backend passes the page's requests
 * to it and holds the Grove sign-in (backend/routers/community.py).
 */
export function Community() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<CommunityStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  // An invitation pasted for a different Grove: switch only when the owner says so.
  const [switchTo, setSwitchTo] = useState<{ origin: string; invite: string } | null>(null)
  // The Grove whose screens are showing. Kept through a failed status check, so a brief outage
  // doesn't throw away the page's state (open IRC rooms, a half-written note).
  const [connected, setConnected] = useState<string | null>(null)

  const refresh = useCallback(() => {
    getCommunityStatus()
      .then(s => {
        setStatus(s); setLoadError('')
        if (s.status === 'running') setConnected(s.url)
      })
      .catch(err => setLoadError(errorText(err)))
  }, [])

  const showing = !!status && connected === status.url
  const starting = status?.status === 'starting'
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, starting ? 1500 : showing ? 20000 : 8000)
    return () => clearInterval(id)
  }, [refresh, starting, showing])

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

  const choose = (url: string | null) => run(async () => {
    const next = await setCommunityAddress(url)
    if (next.url !== status?.url) leaveGrove()
    setStatus(next)
    setEditing(false)
  })

  const groveUrl = status?.url ?? ''
  const joinLink = useCallback((href: string) => {
    let link: URL
    try { link = new URL(href, groveUrl) } catch { return }
    const invite = link.searchParams.get('invite')
    if (!invite) return
    if (link.origin === new URL(groveUrl).origin) navigate(`/community?invite=${encodeURIComponent(invite)}`)
    else setSwitchTo({ origin: link.origin, invite })
  }, [groveUrl, navigate])

  const grove: GroveInfo | null = useMemo(() => status && {
    url: status.url, local: status.mode === 'local', version: status.version, joinLink,
  }, [status, joinLink])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-5 py-2 text-sm">
        <Users size={15} aria-hidden="true" className="text-accent" />
        <span className="font-medium text-text">Grove</span>
        {status && <span className="break-all text-muted">{host(status.url)}</span>}
        {status && (
          <span className="flex items-center gap-1.5 text-muted" role="status">
            <span aria-hidden="true" className={cn('size-2 rounded-full', STATE_DOT[status.status])} />
            {STATE_TEXT[status.status]}{status.version ? ` · v${status.version}` : ''}
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {status?.can_start && (
            <Button size="sm" onClick={() => run(startCommunity)} disabled={busy}>
              <Play size={13} aria-hidden="true" /> Start
            </Button>
          )}
          {status?.can_stop && (
            <Button size="sm" variant="outline" onClick={() => run(stopCommunity)} disabled={busy}>
              <Square size={12} aria-hidden="true" /> Stop
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!status}
            onClick={() => { setAddress(status?.url ?? ''); setEditing(e => !e) }}>
            Change Grove
          </Button>
          <Button size="sm" variant="outline" onClick={() => open('app')} disabled={busy || status?.status !== 'running'}>
            <ExternalLink size={13} aria-hidden="true" /> Open in browser
          </Button>
        </span>
      </div>

      {editing && status && (
        <form className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface2 px-5 py-3 text-sm"
          onSubmit={e => { e.preventDefault(); void choose(address) }}>
          <label className="flex flex-col gap-1 text-muted">
            Grove address
            <input value={address} onChange={e => setAddress(e.target.value)} required maxLength={300}
              placeholder="https://grove.example.com" autoComplete="off" spellCheck={false}
              className="max-w-xl rounded-md border border-border bg-surface px-3 py-2 text-text" />
          </label>
          <p className="m-0 text-muted">
            A Grove on a server: its https:// address. Your Grove password goes only to that Grove; Arynwood keeps
            the sign-in so you stay signed in. Changing Grove signs you out of this one.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" variant="primary" disabled={busy}>Use this Grove</Button>
            {status.url !== status.default_url && (
              <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => void choose(null)}>
                Back to {host(status.default_url)}
              </Button>
            )}
            <Button size="sm" type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {switchTo && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface2 px-5 py-3 text-sm text-text">
          <span>This invitation is for the Grove at <strong>{host(switchTo.origin)}</strong>. Switch to it to join?</span>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => {
            const { origin, invite } = switchTo
            setSwitchTo(null)
            void run(async () => {
              const next = await setCommunityAddress(origin)
              if (next.url !== status?.url) leaveGrove()
              setStatus(next)
              navigate(`/community?invite=${encodeURIComponent(invite)}`)
            })
          }}>Use {host(switchTo.origin)}</Button>
          <Button size="sm" variant="outline" onClick={() => setSwitchTo(null)}>Cancel</Button>
        </div>
      )}

      {(actionError || loadError) && (
        <p role="alert" className="m-0 shrink-0 border-b border-border px-5 py-2 text-sm text-danger">
          {actionError || `Couldn't check the Grove: ${loadError}`}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {showing && grove ? (
          <GroveContext.Provider value={grove}>
            <GroveCommunity key={status.url} />
          </GroveContext.Provider>
        ) : status ? <NotConnected status={status} onRepo={() => open('repo')} /> : null}
      </div>
    </div>
  )
}

function NotConnected({ status, onRepo }: { status: CommunityStatus; onRepo: () => void }) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          Community keeps your people's spaces (calendar, tasks, lists, notes and discussion) on a Grove: one on this
          computer, or one on a server your members reach. Once it's running, it opens here.
        </p>
        <SectionCard title={<span className="flex items-center gap-2"><Users size={14} aria-hidden="true" /> {status.label}</span>}>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Address</dt>
            <dd className="m-0 break-all text-text">{status.url}</dd>
            <dt className="text-muted">Source</dt>
            <dd className="m-0">
              <button type="button" onClick={onRepo}
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
                <dd className="m-0 text-text">On its server, started and stopped there, not here.</dd>
              </>
            )}
          </dl>

          {status.mode === 'remote' && status.status === 'unreachable' && (
            <p className="mb-0 mt-3 text-sm text-muted">
              Arynwood couldn't reach this Grove. Check the address and your connection, or choose another Grove.
            </p>
          )}
          {status.mode === 'local' && status.status === 'stopped' && status.can_start && (
            <p className="mb-0 mt-3 text-sm text-muted">The Grove on this computer isn't running. Start it above.</p>
          )}
          {status.mode === 'local' && status.installed === false && (
            <p className="mb-0 mt-3 text-sm text-muted">
              No Grove is installed there yet. Clone the Source repo into that folder (or set
              <code className="mx-1 text-text">ARYNWOOD_COMMUNITY_DIR</code>
              in <code className="text-text">.env</code> to where your copy lives) and run its setup, or use
              Change Grove for one on a server.
            </p>
          )}
          {status.setup_missing.length > 0 && (
            <p className="mb-0 mt-3 text-sm text-muted">
              The Grove needs its one-time setup before it can start. In a terminal:
              <code className="mt-1.5 block rounded border border-border bg-surface2 px-2 py-1.5 font-mono text-[13px] text-text">
                cd {status.dir} && ./setup.sh
              </code>
            </p>
          )}
          {status.status === 'failed' && status.error && (
            <pre className="mb-0 mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface2 p-2 text-[13px] text-danger">
              {status.error}
            </pre>
          )}
        </SectionCard>
        {status.mode === 'local' && (
          <p className="m-0 text-sm text-muted">
            A Grove on this computer is reachable only here. For members on other computers, run the Grove on a
            server behind HTTPS (see its README) and choose it with Change Grove.
          </p>
        )}
      </div>
    </div>
  )
}

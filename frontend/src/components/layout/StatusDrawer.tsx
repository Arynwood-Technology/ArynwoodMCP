import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Button, IconButton } from '../ui'
import { useAppStore } from '../../store/useAppStore'
import {
  getStatus, getServers, getModels, getGpuQueue, getKnowledgeStatus,
  getMcpServers, getSidecars, startSidecar, pingServer, restartBackend,
  getCommunityStatus, startCommunity, type CommunityStatus,
  type GpuQueue, type KnowledgeStatus, type McpServerInfo, type Sidecar, type Server,
} from '../../lib/api'

type State = 'ok' | 'warn' | 'down' | 'unknown'

const DOT: Record<State, string> = {
  ok: 'bg-success', warn: 'bg-warning', down: 'bg-danger', unknown: 'bg-muted',
}

function StatusRow({
  label, state, detail, fix, action,
}: {
  label: string
  state: State
  detail?: React.ReactNode
  /** Shown only when something is wrong — a concrete next step, not a restatement. */
  fix?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border/60 px-1 py-2 last:border-b-0">
      <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[state])} />
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-text">{label}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted">
            {state === 'unknown' ? 'checking…' : state}
          </span>
        </p>
        {detail && <p className="m-0 mt-0.5 break-words text-[11px] text-muted">{detail}</p>}
        {fix && state !== 'ok' && (
          <p className="m-0 mt-1 rounded border border-border bg-surface2 px-2 py-1 font-mono text-[10px] leading-relaxed text-muted">
            {fix}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="m-0 mb-1 px-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted">{title}</h3>
      {children}
    </section>
  )
}

/** All state lives here rather than in StatusDrawer: Radix unmounts portal
 *  children while closed, so every open starts from a clean fetch instead of
 *  showing whatever was true the last time the drawer was looked at. */
function DrawerBody() {
  const status    = useAppStore(s => s.status)
  const setStatus = useAppStore(s => s.setStatus)
  const activeModel  = useAppStore(s => s.activeModel)
  const activeServer = useAppStore(s => s.activeServer)

  const [servers, setServers]   = useState<Server[]>([])
  // Server rows have no stored connectivity — `Server` is registry data only, so
  // reachability comes from an explicit ping per row.
  const [serverUp, setServerUp] = useState<Record<number, boolean>>({})
  const [modelNames, setModels] = useState<string[] | null>(null)
  const [queue, setQueue]       = useState<GpuQueue | null>(null)
  const [kb, setKb]             = useState<KnowledgeStatus | null>(null)
  const [mcp, setMcp]           = useState<McpServerInfo[] | null>(null)
  const [sidecars, setSidecars] = useState<Record<string, Sidecar> | null>(null)
  const [community, setCommunity] = useState<CommunityStatus | null>(null)
  const [apiUp, setApiUp]       = useState<State>('unknown')
  // Starts true: the mount effect below is already fetching. Setting it in the
  // effect instead would be a synchronous setState on mount.
  const [busy, setBusy]         = useState(true)
  const [pinging, setPinging]   = useState<number | null>(null)

  const refresh = useCallback(async (manual = false) => {
    if (manual) setBusy(true)
    const settle = <T,>(p: Promise<T>, set: (v: T | null) => void) =>
      p.then(v => set(v)).catch(() => set(null))

    await Promise.all([
      getStatus().then(s => { setStatus(s); setApiUp('ok') }).catch(() => setApiUp('down')),
      getServers().then(async list => {
        setServers(list)
        const results = await Promise.all(
          list.filter(s => s.enabled).map(s =>
            pingServer(s.id).then(r => [s.id, r.online] as const).catch(() => [s.id, false] as const),
          ),
        )
        setServerUp(Object.fromEntries(results))
      }).catch(() => setServers([])),
      settle(getGpuQueue(), setQueue),
      settle(getKnowledgeStatus(), setKb),
      settle(getMcpServers(), setMcp),
      settle(getSidecars(), setSidecars),
      settle(getCommunityStatus(), setCommunity),
      getModels(activeServer?.host ?? 'localhost', activeServer?.port ?? 11434)
        .then(r => setModels((r.models ?? []).map(m => m.name)))
        .catch(() => setModels(null)),
    ])
    setBusy(false)
  }, [setStatus, activeServer])

  // Fetch on mount. The rule below fires because `refresh` contains setState
  // calls, but every one of them runs after an await — nothing is set
  // synchronously during the effect, so there is no cascading render to avoid.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])

  const ping = async (id: number) => {
    setPinging(id)
    try {
      const r = await pingServer(id)
      setServerUp(m => ({ ...m, [id]: r.online }))
    } catch { setServerUp(m => ({ ...m, [id]: false })) }
    finally { setPinging(null) }
  }

  const gpu = status?.gpu
  const modelKnown: State =
    modelNames === null ? 'unknown' : modelNames.includes(activeModel) ? 'ok' : 'warn'

  return (
    <Dialog.Content
      aria-describedby={undefined}
      className="fixed right-0 top-0 z-50 flex h-full w-[92vw] max-w-md flex-col border-l border-border bg-surface shadow-2xl"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Dialog.Title className="m-0 flex-1 text-sm font-semibold text-text">System status</Dialog.Title>
        <Button size="sm" variant="outline" onClick={() => refresh(true)} disabled={busy}>
          <RefreshCw size={12} aria-hidden="true" className={busy ? 'animate-spin' : undefined} />
          Refresh
        </Button>
        <Dialog.Close asChild>
          <IconButton size="sm" label="Close system status"><X size={14} /></IconButton>
        </Dialog.Close>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Section title="Backend">
          <StatusRow
            label="API" state={apiUp}
            detail={apiUp === 'ok' ? 'FastAPI responding on /api/system/status' : 'No response from the backend'}
            fix={import.meta.env.PROD
              ? 'Quit and relaunch Arynwood — the packaged app restarts its backend on launch.'
              : 'Check the uvicorn process, then: ./start.sh'}
            action={status?.can_restart === false ? undefined : (
              <Button size="sm" variant="outline"
                onClick={() => { restartBackend().catch(() => {}); setTimeout(() => refresh(true), 3000) }}>
                Restart
              </Button>
            )}
          />
        </Section>

        <Section title="Ollama & servers">
          <StatusRow
            label="Ollama" state={status?.ollama ? 'ok' : 'down'}
            detail="localhost:11434"
            fix="systemctl status ollama — a single model load can fail with cudaMalloc OOM while A1111 holds the 12GB card."
          />
          {servers.map(s => {
            const up = serverUp[s.id]
            return (
              <StatusRow
                key={s.id}
                label={s.name}
                state={!s.enabled || up === undefined ? 'unknown' : up ? 'ok' : 'down'}
                detail={`${s.host}:${s.port}${s.id === activeServer?.id ? ' · active' : ''}${s.enabled ? '' : ' · disabled'}`}
                fix="Unreachable — check the host is up and the port is open."
                action={
                  <Button size="sm" variant="outline" disabled={pinging === s.id} onClick={() => ping(s.id)}>
                    {pinging === s.id ? 'Pinging…' : 'Ping'}
                  </Button>
                }
              />
            )
          })}
          <StatusRow
            label="Active model" state={modelKnown}
            detail={activeModel}
            fix={modelNames === null
              ? 'Could not list models on this server, so the name is unverified.'
              : `Not installed on this server. Pull it: ollama pull ${activeModel}`}
          />
        </Section>

        <Section title="GPU">
          <StatusRow
            label="Device" state={gpu?.available ? 'ok' : 'down'}
            detail={gpu?.available
              ? `${gpu.name ?? 'GPU'} · ${gpu.utilization}% · ${gpu.memory_used}/${gpu.memory_total}MB · ${gpu.temp}°C`
              : 'nvidia-smi reported no device'}
            fix="nvidia-smi not returning a device — check the driver."
          />
          <StatusRow
            label="Job queue"
            state={typeof queue?.depth !== 'number' ? 'unknown' : queue.depth > 1 ? 'warn' : 'ok'}
            detail={typeof queue?.depth !== 'number'
              ? 'Unavailable'
              : queue.running
                ? `Running ${queue.running}${queue.waiting?.length ? ` · ${queue.waiting.length} waiting` : ''}`
                : 'Idle'}
            fix="Work is serialised on one GPU, so a queued job waits rather than failing."
          />
        </Section>

        <Section title="Knowledge base">
          <StatusRow
            label="Qdrant"
            state={!kb?.qdrant ? 'unknown' : kb.qdrant.online ? (kb.qdrant.collection_ready ? 'ok' : 'warn') : 'down'}
            detail={!kb?.qdrant ? 'Unavailable'
              : kb.qdrant.online ? (kb.qdrant.collection_ready ? 'Collection ready' : 'Online, collection not created yet')
              : 'Offline'}
            fix="/api/knowledge needs Qdrant up; learn/search will fail without it."
          />
          <StatusRow
            label="Embedding model"
            state={!kb?.embedding_model ? 'unknown' : kb.embedding_model_available ? 'ok' : 'down'}
            detail={kb?.embedding_model ?? 'Unavailable'}
            fix={kb?.embedding_model ? `ollama pull ${kb.embedding_model}` : 'Could not query the knowledge router.'}
          />
        </Section>

        <Section title="MCP tool servers">
          {!Array.isArray(mcp) && <StatusRow label="Registry" state="unknown" detail="Could not read /api/mcp/servers" />}
          {Array.isArray(mcp) && mcp.length === 0 && (
            <StatusRow
              label="No servers registered" state="warn"
              detail="All MCP tool dispatch is silently disabled — gates are skipped before they run."
              fix="mcp/config/mcp_servers.json is absent. It's gitignored per-install config; create it to enable Kdenlive etc."
            />
          )}
          {Array.isArray(mcp) && mcp.map(s => (
            <StatusRow key={s.name} label={s.name} state="ok" detail={s.url} />
          ))}
        </Section>

        <Section title="MusicStudio sidecars">
          {sidecars === null
            ? <StatusRow label="Sidecars" state="unknown" detail="Could not read /api/studio/sidecars" />
            : Object.values(sidecars).map(sc => {
                const running = sc.status === 'running'
                return (
                  <StatusRow
                    key={sc.id} label={sc.label}
                    state={running ? 'ok' : 'down'}
                    detail={sc.status === 'failed' && sc.error ? `port ${sc.port} · crashed: ${sc.error.split('\n').slice(-2).join(' ')}` : `port ${sc.port} · ${sc.status}`}
                    fix={sc.status === 'failed'
                      ? `It crashed on start. Full log: ~/.local/share/arynwood-mcp/logs/sidecar-${sc.id}.log`
                      : 'Start it here; if that fails the venv is probably missing — see MusicStudio/CLAUDE.md.'}
                    action={running ? undefined : (
                      <Button size="sm" variant="outline"
                        onClick={() => { startSidecar(sc.id).catch(() => {}); setTimeout(() => refresh(true), 2500) }}>
                        Start
                      </Button>
                    )}
                  />
                )
              })}
        </Section>

        <Section title="Other services">
          <StatusRow
            label="Stable Diffusion" state={status?.stable_diffusion ? 'ok' : 'down'}
            detail="A1111 · localhost:7860"
            fix="docker restart a1111 — check /sdapi/v1/progress first so nothing is mid-render."
          />
          <StatusRow
            label="TortoiseTTS" state={status?.tortoise_tts ? 'ok' : 'down'}
            detail="localhost:5003"
            fix="docker compose up -d tortoise-tts"
          />
          <StatusRow
            label="Prometheus" state={status?.prometheus ? 'ok' : 'down'}
            detail="localhost:9090"
            fix="docker compose up -d prometheus"
          />
          {community && (
            <StatusRow
              label="Arynwood Community (optional)"
              state={community.status === 'running' ? 'ok'
                : community.mode === 'local' && (!community.installed || community.setup_missing.length) ? 'warn' : 'down'}
              detail={`${community.url} · ${community.status}${community.version ? ` · v${community.version}` : ''}`}
              fix={community.mode === 'remote' ? 'Hosted — check its server, or ARYNWOOD_COMMUNITY_URL in .env.'
                : !community.installed ? `Not installed at ${community.dir}. Set ARYNWOOD_COMMUNITY_DIR if it lives elsewhere.`
                : community.setup_missing.length ? `cd ${community.dir} && ./setup.sh`
                : community.status === 'failed' ? 'It crashed on start. Log: ~/.local/share/arynwood-mcp/logs/sidecar-community.log'
                : 'Start it here, or from the Community page.'}
              action={community.can_start ? (
                <Button size="sm" variant="outline"
                  onClick={() => { startCommunity().catch(() => {}); setTimeout(() => refresh(true), 2500) }}>
                  Start
                </Button>
              ) : undefined}
            />
          )}
        </Section>
      </div>
    </Dialog.Content>
  )
}

export function StatusDrawer() {
  const open    = useAppStore(s => s.statusDrawerOpen)
  const setOpen = useAppStore(s => s.setStatusDrawerOpen)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <DrawerBody />
      </Dialog.Portal>
    </Dialog.Root>
  )
}

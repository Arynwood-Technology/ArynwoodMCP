import { useEffect, useState } from 'react'
import {
  Disc3, Music4, Waves, ShieldCheck, SlidersHorizontal,
  Play, Loader2, ExternalLink, ChevronDown, ChevronUp,
  FileText, BookOpen, CheckCircle2, Circle, PlugZap,
} from 'lucide-react'
import {
  getDjTools, launchDjTool, getDjSessions, startDjSession,
  getDjDocs, openDjDoc,
  type DjTool, type DjSession, type DjDoc,
} from '../lib/api'

// ── Category meta ────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; sub: string; Icon: any; color: string }> = {
  dj:      { label: 'DJ Mixing',              sub: 'Live mixing / beatmatching',           Icon: Disc3,             color: '#7c6ef7' },
  daw:     { label: 'Production',             sub: 'Arrangement, drums, mixdown',          Icon: Music4,            color: '#f472b6' },
  synth:   { label: 'Synths & Sound Design',  sub: 'Basslines, leads, drum synthesis',     Icon: Waves,             color: '#5eead4' },
  utility: { label: 'Utilities',              sub: 'Sandbox / permissions',                Icon: ShieldCheck,       color: '#facc15' },
  plugin:  { label: 'Mixing Plugins',         sub: 'Load inside Ardour — not standalone',  Icon: SlidersHorizontal, color: '#38bdf8' },
}
const CATEGORY_ORDER = ['dj', 'daw', 'synth', 'utility', 'plugin']

const STATUS_COLOR: Record<string, string> = {
  running: '#22c55e',
  stopped: '#6b7280',
  plugin:  '#38bdf8',
  unknown: '#f59e0b',
}
const STATUS_LABEL: Record<string, string> = {
  running: 'running',
  stopped: 'not running',
  plugin:  'plugin — no standalone app',
  unknown: 'unknown',
}

// ── Tool card ─────────────────────────────────────────────────────────────────

function DjToolCard({ tool, launching, onLaunch }: { tool: DjTool; launching: boolean; onLaunch: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const cat = CATEGORY_META[tool.category] ?? CATEGORY_META.dj
  const statusColor = STATUS_COLOR[tool.status] ?? '#6b7280'
  const hasManual = tool.quickstart.length > 0 || tool.tips.length > 0 || tool.manual_url || tool.tutorial_url

  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <cat.Icon size={16} color={cat.color} />
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{tool.name}</div>
          {tool.version && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>v{tool.version}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          <span style={{ fontSize: 9, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{STATUS_LABEL[tool.status]}</span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{tool.role}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 10 }}>{tool.description}</div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {tool.launchable ? (
          <button
            onClick={() => onLaunch(tool.id)}
            disabled={launching}
            style={{
              background: cat.color + '22', border: `1px solid ${cat.color}55`, color: cat.color,
              borderRadius: 6, padding: '4px 10px', cursor: launching ? 'default' : 'pointer',
              fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
            }}>
            {launching ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />}
            {tool.status === 'running' ? 'Launch another' : 'Launch'}
          </button>
        ) : (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-muted)',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px',
          }}>
            <PlugZap size={11} /> Loads inside {tool.host === 'ardour' ? 'Ardour' : 'its host DAW'}
          </span>
        )}
        {tool.manual_url && (
          <a href={tool.manual_url} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-muted)',
            textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px',
          }}>
            <ExternalLink size={10} /> {tool.manual_label ?? 'Manual'}
          </a>
        )}
        {tool.tutorial_url && (
          <a href={tool.tutorial_url} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-muted)',
            textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px',
          }}>
            <ExternalLink size={10} /> {tool.tutorial_label ?? 'Tutorials'}
          </a>
        )}
        {hasManual && (tool.quickstart.length > 0 || tool.tips.length > 0) && (
          <button onClick={() => setOpen(o => !o)} style={{
            marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 3, padding: '4px 2px',
          }}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            How to use it
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          {tool.quickstart.length > 0 && (
            <div style={{ marginBottom: tool.tips.length > 0 ? 10 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>Quickstart</div>
              <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tool.quickstart.map((step, i) => (
                  <li key={i} style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.45 }}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {tool.tips.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>Tips & gotchas</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tool.tips.map((tip, i) => (
                  <li key={i} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session, tools, starting, onStart }: {
  session: DjSession; tools: DjTool[]; starting: boolean; onStart: (id: string) => void
}) {
  const sessionTools = session.tool_ids.map(id => tools.find(t => t.id === id)).filter(Boolean) as DjTool[]
  const allRunning = sessionTools.length > 0 && sessionTools.every(t => t.status === 'running')

  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 240px', minWidth: 220,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{session.label}</div>
        {allRunning && <CheckCircle2 size={14} color="#22c55e" />}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45, flex: 1 }}>{session.description}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {sessionTools.map(t => (
          <span key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)',
            background: 'var(--surface)', borderRadius: 4, padding: '2px 6px',
          }}>
            {t.status === 'running' ? <CheckCircle2 size={9} color="#22c55e" /> : <Circle size={9} />}
            {t.name}
          </span>
        ))}
      </div>
      <button onClick={() => onStart(session.id)} disabled={starting} style={{
        background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 6,
        padding: '7px 12px', cursor: starting ? 'default' : 'pointer', fontSize: 12, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {starting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} />}
        {allRunning ? 'Already running' : 'Start session'}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DJStudio() {
  const [tools, setTools] = useState<DjTool[]>([])
  const [sessions, setSessions] = useState<DjSession[]>([])
  const [docs, setDocs] = useState<DjDoc[]>([])
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [startingSession, setStartingSession] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadTools = async () => {
    try { setTools(await getDjTools()) } catch { /* backend down */ }
  }

  useEffect(() => {
    loadTools()
    getDjSessions().then(setSessions).catch(() => {})
    getDjDocs().then(setDocs).catch(() => {})
    const t = setInterval(loadTools, 5000)
    return () => clearInterval(t)
  }, [])

  const launch = async (id: string) => {
    setLaunchingId(id)
    setError(null)
    try {
      await launchDjTool(id)
      const tool = tools.find(t => t.id === id)
      setMessage(`Launched ${tool?.name ?? id}.`)
      await new Promise(r => setTimeout(r, 1200))
      await loadTools()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to launch this tool.')
    }
    setLaunchingId(null)
  }

  const startSession = async (id: string) => {
    setStartingSession(id)
    setError(null)
    try {
      const { results } = await startDjSession(id)
      const launched = results.filter(r => r.launched).map(r => tools.find(t => t.id === r.tool_id)?.name ?? r.tool_id)
      setMessage(launched.length > 0 ? `Launched ${launched.join(', ')}.` : 'Everything in this session is already running.')
      await new Promise(r => setTimeout(r, 1200))
      await loadTools()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to start this session.')
    }
    setStartingSession(null)
  }

  const openDoc = async (id: string) => {
    setError(null)
    try {
      const { opened } = await openDjDoc(id)
      setMessage(`Opened ${opened} in your default app.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to open that file.')
    }
  }

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(t)
  }, [message])

  const grouped = CATEGORY_ORDER.map(cat => ({ cat, items: tools.filter(t => t.category === cat) })).filter(g => g.items.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>

      <div style={{ flex: 1, overflow: 'auto', padding: 24, maxWidth: 980 }}>

        {/* Getting started strip */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <BookOpen size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>New here? Start with a session below.</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Everything on this page runs as a native app on this machine — launching just opens it, same as clicking it in your app menu.
              Program drums in Hydrogen, arrange/mix in Ardour, beatmatch and blend in Mixxx.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {docs.map(d => (
              <button key={d.id} onClick={() => openDoc(d.id)} title={d.description} disabled={!d.exists} style={{
                background: 'var(--surface2)', border: '1px solid var(--border)', color: d.exists ? 'var(--text-muted)' : 'var(--text-muted)',
                opacity: d.exists ? 1 : 0.5, borderRadius: 6, padding: '6px 10px', cursor: d.exists ? 'pointer' : 'not-allowed',
                fontSize: 11, display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <FileText size={12} /> {d.label}
              </button>
            ))}
          </div>
        </div>

        {(message || error) && (
          <div role={error ? 'alert' : 'status'} style={{
            padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 12,
            background: error ? 'rgba(239,68,68,0.09)' : 'rgba(34,197,94,0.09)',
            border: `1px solid ${error ? 'rgba(239,68,68,0.24)' : 'rgba(34,197,94,0.24)'}`,
            color: error ? '#fca5a5' : '#4ade80',
          }}>
            {error ?? message}
          </div>
        )}

        {/* Sessions */}
        {sessions.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Start a session
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {sessions.map(s => (
                <SessionCard key={s.id} session={s} tools={tools} starting={startingSession === s.id} onStart={startSession} />
              ))}
            </div>
          </div>
        )}

        {/* Tool grid, grouped by category */}
        {grouped.map(({ cat, items }) => {
          const meta = CATEGORY_META[cat]
          return (
            <div key={cat} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <meta.Icon size={13} color={meta.color} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{meta.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {meta.sub}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {items.map(t => (
                  <DjToolCard key={t.id} tool={t} launching={launchingId === t.id} onLaunch={launch} />
                ))}
              </div>
            </div>
          )
        })}

        {tools.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
            Loading DJ toolkit… (is the backend running?)
          </div>
        )}
      </div>
    </div>
  )
}

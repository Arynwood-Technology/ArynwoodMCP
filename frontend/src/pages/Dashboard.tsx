import { useEffect, useState, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Cpu, Server, Wrench, Palette, Brain, Music2, Share2, Clapperboard,
  RotateCcw, Paperclip, ArrowRight, X,
} from 'lucide-react'
import { Button, IconButton, StatusBadge, SectionLabel, PageShell, PageBar, EmptyState } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { getServers, uploadFile } from '../lib/api'
import { ChatSocket } from '../lib/ws'

// ── Quick links ───────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { to: '/tools',     icon: Wrench,       label: 'Tools',         desc: 'GPU generation tools' },
  { to: '/studio',    icon: Music2,       label: 'Music',         desc: 'Stems, RVC, mastering' },
  { to: '/video',     icon: Clapperboard, label: 'Video Studio',  desc: 'Kdenlive automation' },
  { to: '/design',    icon: Palette,      label: 'Design Center', desc: 'Canvas & image editing' },
  { to: '/social',    icon: Share2,       label: 'Social Media',  desc: 'Publish generated content' },
  { to: '/knowledge', icon: Brain,        label: 'Knowledge',     desc: 'Semantic search / !learn' },
  { to: '/models',    icon: Cpu,          label: 'Models',        desc: 'Ollama model manager' },
  { to: '/servers',   icon: Server,       label: 'Servers',       desc: 'Ollama server registry' },
]

function QuickLinks() {
  return (
    <nav aria-label="Quick links" className="grid grid-cols-2 gap-2">
      {QUICK_LINKS.map(l => (
        <Link
          key={l.to}
          to={l.to}
          className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-text no-underline transition-colors hover:border-accent"
        >
          <l.icon size={18} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-text">{l.label}</span>
            <span className="mt-px block text-[10px] text-muted">{l.desc}</span>
          </span>
        </Link>
      ))}
    </nav>
  )
}

// ── Arynwood chat widget ──────────────────────────────────────────────────────────

function stripInternalBlocks(t: string) {
  return t.replace(/<remember\b[^>]*>[\s\S]*?<\/remember>/gi, '').trim()
}

function ArynwoodChat() {
  const { activeServer, setActiveServer, activeModel, setActiveModel, servers, setServers,
          dashMsgs, setDashMsgs, dashConvId, setDashConvId } = useAppStore()
  const msgs    = dashMsgs
  const setMsgs = setDashMsgs
  const [input, setInput]           = useState('')
  const [streaming, setStreaming]   = useState(false)
  const [streamBuf, setStreamBuf]   = useState('')
  const [wsReady, setWsReady]       = useState(false)
  const bufRef = useRef('')
  const [editingModel, setEditingModel] = useState(false)
  const [modelDraft, setModelDraft]     = useState('')
  const [attachment, setAttachment]     = useState<{ name: string; text: string } | null>(null)
  const [uploading, setUploading]       = useState(false)
  const wsRef     = useRef<ChatSocket | null>(null)
  const convRef   = useRef<number | null>(dashConvId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  const navigate  = useNavigate()

  useEffect(() => {
    if (servers.length === 0) {
      getServers().then(list => {
        setServers(list)
        if (!activeServer && list.length > 0) {
          const local = list.find(s => s.host === 'localhost' || s.host === '127.0.0.1' || s.host === '0.0.0.0') ?? list[0]
          setActiveServer(local)
        }
      }).catch(() => {})
    }
  }, [servers, activeServer, setServers, setActiveServer])

  useEffect(() => {
    const ws = new ChatSocket(
      (msg) => {
        if (msg.type === 'conversation_id') { convRef.current = msg.id; setDashConvId(msg.id) }
        else if (msg.type === 'token') {
          bufRef.current += msg.token
          if (msg.done) {
            const text = stripInternalBlocks(bufRef.current)
            bufRef.current = ''; setStreamBuf('')
            setMsgs(p => [...p, { id: Date.now(), role: 'assistant', text }]); setStreaming(false)
          } else { setStreamBuf(bufRef.current) }
        } else if (msg.type === 'error') {
          setStreaming(false); setStreamBuf('')
          setMsgs(p => [...p, { id: Date.now(), role: 'error', text: msg.message }])
        }
      },
      () => setWsReady(true),
      () => setWsReady(false),
    )
    ws.connect(); wsRef.current = ws; return () => ws.disconnect()
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, streamBuf])

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''; setUploading(true)
    try {
      const res = await uploadFile(file); setAttachment({ name: res.filename, text: res.text })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMsgs(p => [...p, { id: Date.now(), role: 'error', text: `Upload failed: ${msg}` }])
    } finally { setUploading(false) }
  }

  const send = useCallback(() => {
    const text = input.trim()
    if ((!text && !attachment) || streaming || !wsReady) return
    const fullMessage = attachment ? `[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\`\n\n${text}` : text
    setInput(''); setAttachment(null); setStreaming(true)
    setMsgs(p => [...p, { id: Date.now(), role: 'user', text: attachment ? `📎 ${attachment.name}${text ? ` — ${text}` : ''}` : text }])
    wsRef.current?.send({ message: fullMessage, persona: 'central', model: activeModel, server_host: activeServer?.host ?? 'localhost', server_port: activeServer?.port ?? 11434, conversation_id: convRef.current ?? undefined })
  }, [input, attachment, streaming, wsReady, activeServer, activeModel])

  const ollamaServers = servers.filter(s => s.type === 'ollama' && s.enabled)
  const canSend = wsReady && !streaming && (!!input.trim() || !!attachment)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">A</span>
          <div>
            <p className="m-0 text-[13px] font-bold text-text">Arynwood</p>
            <p className="m-0 flex items-center gap-1">
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${wsReady ? 'bg-success' : 'bg-warning'}`} />
              <span className="text-[10px] text-muted">{wsReady ? 'connected' : 'connecting…'}</span>
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="text-[10px] text-muted" onClick={() => navigate('/chat')}>
          Full chat <ArrowRight size={11} aria-hidden="true" />
        </Button>
      </div>

      {/* Model / server */}
      <div className="mb-2 flex items-center gap-1.5">
        {editingModel ? (
          <input autoFocus value={modelDraft} onChange={e => setModelDraft(e.target.value)}
            aria-label="Model name"
            onBlur={() => { if (modelDraft.trim()) setActiveModel(modelDraft.trim()); setEditingModel(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { if (modelDraft.trim()) setActiveModel(modelDraft.trim()); setEditingModel(false) } if (e.key === 'Escape') setEditingModel(false) }}
            className="w-25 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text" />
        ) : (
          <Button
            size="sm"
            title="Click to change model"
            onClick={() => { setModelDraft(activeModel); setEditingModel(true) }}
            className="h-auto shrink-0 border-accent/30 bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/20"
          >
            ⬡ {activeModel}
          </Button>
        )}
        {ollamaServers.length > 0 ? (
          <select value={activeServer?.id ?? ''} aria-label="Ollama server"
            onChange={e => { const s = ollamaServers.find(x => x.id === Number(e.target.value)); if (s) setActiveServer(s) }}
            className="flex-1 cursor-pointer rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text">
            {ollamaServers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host}:{s.port})</option>)}
          </select>
        ) : (
          <span className="text-[10px] italic text-muted">{activeServer ? `${activeServer.host}:${activeServer.port}` : 'localhost:11434'}</span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-auto pr-0.5">
        {msgs.length === 0 && !streaming && (
          <EmptyState className="py-6" title="Ask Arynwood anything — video editing, sound, design, generation…" />
        )}
        {msgs.map(m => {
          if (m.role === 'error') return (
            <p key={m.id} role="alert" className="m-0 flex items-center gap-[7px] rounded-[7px] border border-danger/30 bg-danger/8 px-2.5 py-[7px] text-[11px]">
              <span aria-hidden="true">⚠️</span><span className="text-danger">{m.text}</span>
            </p>
          )
          const mine = m.role === 'user'
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <p className={`m-0 max-w-[88%] whitespace-pre-wrap break-words rounded-[10px] px-[11px] py-[7px] text-xs leading-normal text-text ${
                mine ? 'rounded-br-[2px] bg-accent' : 'rounded-bl-[2px] border border-border bg-surface'
              }`}>
                {m.text}
              </p>
            </div>
          )
        })}
        {streaming && (
          <div className="flex justify-start">
            <p className="m-0 max-w-[88%] whitespace-pre-wrap break-words rounded-[10px] rounded-bl-[2px] border border-border bg-surface px-[11px] py-[7px] text-xs leading-normal text-text">
              {stripInternalBlocks(streamBuf) || <span className="opacity-40">Thinking…</span>}
              <span aria-hidden="true" className="ml-0.5 opacity-40">▋</span>
            </p>
          </div>
        )}
      </div>

      {/* Attachment */}
      {attachment && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1">
          <Paperclip size={11} aria-hidden="true" className="shrink-0 text-accent" />
          <span className="flex-1 truncate text-[11px] text-accent">{attachment.name}</span>
          <IconButton size="sm" label="Remove attachment" className="size-4" onClick={() => setAttachment(null)}>
            <X size={12} />
          </IconButton>
        </div>
      )}

      <input ref={fileRef} type="file" className="hidden" onChange={pickFile}
        accept=".txt,.md,.py,.js,.ts,.jsx,.tsx,.json,.yaml,.yml,.csv,.log,.sh,.html,.css,.sql,.pdf,.docx,.toml,.ini,.cfg,.rs,.go,.java,.c,.cpp,.rb" />

      {/* Input */}
      <div className="mt-[7px] flex gap-1.5">
        <IconButton
          size="sm" variant="secondary" label={uploading ? 'Uploading file…' : 'Attach file'}
          onClick={() => fileRef.current?.click()} disabled={!wsReady || streaming || uploading}
        >
          <Paperclip size={14} />
        </IconButton>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send() }}
          placeholder={wsReady ? (attachment ? 'Add a message…' : 'Ask Arynwood…') : 'Connecting…'}
          aria-label="Message Arynwood"
          disabled={!wsReady || streaming}
          className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text disabled:opacity-50" />
        <IconButton size="sm" variant="primary" label="Send message" onClick={send} disabled={!canSend}>
          <ArrowRight size={14} />
        </IconButton>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function Dashboard() {
  // Status itself is polled by AppShell — it drives chrome visible on every
  // page, so it can't be owned by one page's lifecycle.
  const status = useAppStore(s => s.status)
  const [restarting, setRestarting] = useState(false)

  const restartBackend = async () => {
    setRestarting(true)
    try {
      await fetch('/api/system/restart', { method: 'POST' })
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000))
        try { const r = await fetch('/api/system/status'); if (r.ok) { setRestarting(false); break } } catch {}
      }
    } catch { setRestarting(false) }
  }

  return (
    <PageShell>
      <PageBar>
        {status ? (
          <>
            <StatusBadge online={status.ollama}           label="Ollama"  to="/models" />
            <StatusBadge online={status.stable_diffusion} label="SD"      to="/tools" />
            <StatusBadge online={status.tortoise_tts}     label="TTS"     to="/tools" />
            <StatusBadge online={status.prometheus}       label="Metrics" href="http://localhost:9090" />
            {status.gpu?.available && (
              <p className="m-0 ml-1 flex gap-2.5 text-[11px] text-muted">
                <span className="text-warning">{status.gpu.temp}°C</span>
                <span>{status.gpu.utilization}% util</span>
                <span className="text-accent">{status.gpu.memory_used}/{status.gpu.memory_total}MB</span>
              </p>
            )}
          </>
        ) : <span className="text-[11px] text-muted">Checking services…</span>}
        <Button
          size="sm" variant="outline" className="ml-auto"
          onClick={restartBackend} disabled={restarting}
        >
          <RotateCcw size={12} aria-hidden="true" className={restarting ? 'animate-spin' : undefined} />
          {restarting ? 'Restarting…' : 'Restart API'}
        </Button>
      </PageBar>

      {/* Two-column layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-70 flex-1 flex-col overflow-hidden border-r border-border px-4 py-3.5">
          <ArynwoodChat />
        </div>
        <aside className="w-105 shrink-0 overflow-auto px-4 py-3.5">
          <SectionLabel>Quick links</SectionLabel>
          <QuickLinks />
        </aside>
      </div>
    </PageShell>
  )
}

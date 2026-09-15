import { useEffect, useRef, useState, useCallback, type FC } from 'react'
import { Send, Plus, Trash2, Settings2, Check, ChevronDown, ChevronRight, Brain, Pin, Search, Paperclip, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, IconButton, EmptyState, PageShell } from '../components/ui'
import { cn } from '../lib/cn'
import { useAppStore } from '../store/useAppStore'
import { usePageTitle } from '../components/layout/usePageTitle'

const ARYNWOOD = { name: 'Arynwood', color: '#7c6ef7' }
import { getConversations, getMessages, deleteConversation, uploadFile } from '../lib/api'
import type { Message } from '../lib/api'
import { ChatSocket } from '../lib/ws'

interface ActionResult {
  name: string
  ok: boolean
  status?: number
  response?: string
  error?: string
  isMem?: boolean
  isContext?: boolean
  contextDetails?: string[]
}

function stripInternalBlocks(text: string) {
  return text
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    .replace(/<remember\b[^>]*>[\s\S]*?<\/remember>/gi, '')
    .trim()
}

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mt-0 mb-2">{children}</p>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mt-2.5 mb-1.5 text-base font-bold">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mt-2.5 mb-1 text-sm font-bold">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mt-2 mb-1 text-[13px] font-bold">{children}</h3>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mt-1 mb-2 list-disc pl-[18px]">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mt-1 mb-2 list-decimal pl-[18px]">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="my-0.5">{children}</li>,
  code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
    inline
      ? <code className="rounded bg-white/8 px-1.5 py-px font-mono text-xs">{children}</code>
      : <code>{children}</code>,
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-1.5 overflow-x-auto rounded-md bg-white/8 px-3 py-2.5 font-mono text-xs">{children}</pre>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-2.5 border-none border-t border-border" />,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-1.5 border-l-[3px] border-accent pl-2.5 opacity-85">{children}</blockquote>
  ),
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  )
}

const ActionCard: FC<{ result: ActionResult }> = ({ result }) => {
  const [expanded, setExpanded] = useState(false)

  if (result.isContext) return (
    <div className="mt-1 overflow-hidden rounded-lg border border-sky-400/20 bg-sky-400/8 text-[11px] text-sky-400">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-2.5 py-[5px] text-left text-inherit"
      >
        {expanded ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
        <Search size={11} aria-hidden="true" />
        {result.name}
      </button>
      {expanded && result.contextDetails && (
        <ul className="m-0 grid list-none gap-0.5 py-0 pr-2.5 pb-2 pl-[27px] text-muted">
          {result.contextDetails.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  )

  if (result.isMem) return (
    <p className="m-0 mt-1 flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/8 px-2.5 py-[5px] text-[11px] text-violet-400">
      <span aria-hidden="true">🧠</span> {result.name}
    </p>
  )

  return (
    <div className={cn(
      'mt-1.5 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-xs',
      result.ok ? 'border-success/30 bg-success/8' : 'border-danger/30 bg-danger/8',
    )}>
      <span aria-hidden="true" className="shrink-0 text-base">{result.ok ? '⚡' : '⚠️'}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('m-0 mb-0.5 font-bold', result.ok ? 'text-success' : 'text-danger')}>
          {result.ok ? 'Triggered' : 'Failed'}: {result.name}
        </p>
        {result.status !== undefined && (
          <p className="m-0 text-[11px] text-muted">HTTP {result.status}</p>
        )}
        {(result.response || result.error) && (
          <p className="m-0 mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
            {result.response ?? result.error}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Collapsible sidebar section ───────────────────────────────────────────────

function PanelToggle({
  open, onToggle, icon, children, badge, controls,
}: {
  open: boolean; onToggle: () => void; icon: React.ReactNode
  children: React.ReactNode; badge?: React.ReactNode; controls: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-0 py-1 text-[11px] text-muted hover:text-text"
    >
      {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      {icon}
      {children}
      {badge}
    </button>
  )
}

// ── Agent config panel ─────────────────────────────────────────────────────────

function AgentConfigPanel() {
  const [open, setOpen]       = useState(false)
  const [context, setContext] = useState('')
  const [maxHist, setMaxHist] = useState(30)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch('/api/chat/agent-config').then(r => r.json()).then(d => {
      setContext(d.context ?? '')
      setMaxHist(d.max_history ?? 30)
    }).catch(() => {})
  }, [open])

  const save = async () => {
    setLoading(true)
    await fetch('/api/chat/agent-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, max_history: maxHist }),
    })
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="border-t border-border px-2.5 py-2">
      <PanelToggle
        open={open} onToggle={() => setOpen(o => !o)} controls="agent-config-panel"
        icon={<Settings2 size={12} aria-hidden="true" />}
      >
        Agent Config
      </PanelToggle>

      <div id="agent-config-panel" className={cn('mt-2.5 flex-col gap-2.5', open ? 'flex' : 'hidden')}>
        <div>
          <label htmlFor="agent-context" className="mb-1 block text-[10px] text-muted">
            Context / notes injected into every system prompt
          </label>
          <textarea
            id="agent-context"
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder={
              'Tell the agent about yourself and your setup.\n\n' +
              'Examples:\n' +
              '- My name is ..., I work on ...\n' +
              '- Primary language: Python, prefer async\n' +
              '- GPU: RTX 3070 8GB\n' +
              '- Ollama remote: my-server:11434\n' +
              '- Preferred TTS: Kokoro\n' +
              '- Working on: my project'
            }
            rows={9}
            className="w-full resize-y rounded-md border border-border bg-surface2 px-2 py-1.5 text-[11px] leading-normal text-text"
          />
        </div>

        <div>
          <label htmlFor="agent-history" className="mb-1 block text-[10px] text-muted">
            Conversation history window (messages)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="agent-history"
              type="range" min={4} max={100} step={2} value={maxHist}
              onChange={e => setMaxHist(Number(e.target.value))}
              aria-describedby="agent-history-hint"
              className="flex-1"
            />
            <output className="min-w-6 text-right text-[11px] text-text">{maxHist}</output>
          </div>
          <p id="agent-history-hint" className="m-0 mt-0.5 text-[9px] text-muted">
            How many prior messages to send as context on each turn
          </p>
        </div>

        <Button
          variant={saved ? undefined : 'primary'}
          onClick={save}
          disabled={loading}
          className={cn('w-full', saved && 'border-transparent bg-success text-white hover:bg-success')}
        >
          {saved ? <><Check size={12} aria-hidden="true" /> Saved</> : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ── Memory panel ──────────────────────────────────────────────────────────────

interface Memory {
  id: number; type: string; title: string; content: string; pinned: number
  status: string; volatility: string; conflict_with_id: number | null; updated_at: string
}

const TYPE_COLORS: Record<string, string> = {
  project: '#7c6ef7', idea: '#f472b6', decision: '#fb923c',
  fact: '#38bdf8', note: 'var(--color-muted)',
}

function MemoryPanel({ refreshTrigger }: { refreshTrigger: number }) {
  const [open, setOpen]       = useState(false)
  const [memories, setMemories] = useState<Memory[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/memory').then(r => r.json()).then(setMemories).catch(() => {})
  }, [open, refreshTrigger])

  const del = async (id: number) => {
    await fetch(`/api/memory/${id}`, { method: 'DELETE' })
    setMemories(m => m.filter(x => x.id !== id))
  }

  const pin = async (mem: Memory) => {
    await fetch(`/api/memory/${mem.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...mem, pinned: mem.pinned ? 0 : 1 }),
    })
    setMemories(m => m.map(x => x.id === mem.id ? { ...x, pinned: x.pinned ? 0 : 1 } : x))
  }

  const confirm = async (id: number) => {
    await fetch(`/api/memory/${id}/confirm`, { method: 'POST' })
    setMemories(m => m.map(x => x.id === id ? { ...x, status: 'confirmed' } : x))
  }

  const unconfirmedCount = memories.filter(m => m.status === 'provisional').length

  return (
    <div className="border-t border-border px-2.5 py-2">
      <PanelToggle
        open={open} onToggle={() => setOpen(o => !o)} controls="memory-panel"
        icon={<Brain size={12} aria-hidden="true" />}
        badge={unconfirmedCount > 0 ? (
          <span className="ml-auto rounded-full bg-yellow-400 px-1.5 py-px text-[9.5px] font-bold text-[#0b0d10]">
            {unconfirmedCount} to review
          </span>
        ) : undefined}
      >
        Arynwood&apos;s Memory {memories.length > 0 && open ? `(${memories.length})` : ''}
      </PanelToggle>

      <div id="memory-panel" className={cn('mt-2 max-h-70 flex-col gap-1 overflow-y-auto', open ? 'flex' : 'hidden')}>
        {memories.length === 0 && (
          <p className="m-0 py-1 text-[11px] italic text-muted">
            No memories yet. Arynwood will save things here automatically.
          </p>
        )}
        {memories.map(m => {
          const isOpen = expanded === m.id
          const bodyId = `memory-${m.id}-body`
          return (
            <div key={m.id} className="overflow-hidden rounded-[7px] border border-border bg-surface2">
              <div className="flex items-center gap-1.5 px-2 py-[5px]">
                <button
                  type="button"
                  onClick={() => setExpanded(e => e === m.id ? null : m.id)}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left"
                >
                  {/* Data-driven colour — can't be a static utility class. */}
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full"
                    style={{ background: TYPE_COLORS[m.type] ?? '#888' }} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-text">{m.title}</span>
                </button>
                {m.status === 'provisional' && (
                  <span title="Saved automatically — not yet reviewed"
                    className="shrink-0 rounded bg-yellow-400/22 px-1.5 py-px text-[9px] font-bold text-[#8a6d1a]">
                    UNCONFIRMED
                  </span>
                )}
                {m.conflict_with_id != null && (
                  <span title="May contradict another memory — check the expanded view"
                    className="shrink-0 rounded bg-red-600 px-1.5 py-px text-[9px] font-bold text-white">
                    CONFLICT
                  </span>
                )}
                {m.volatility === 'transient' && (
                  <span title="Short-term task state"
                    className="shrink-0 rounded border border-border px-1.5 py-px text-[9px] font-semibold text-muted">
                    short-term
                  </span>
                )}
                <IconButton
                  size="sm" className="size-5 shrink-0"
                  label={m.pinned ? `Unpin ${m.title}` : `Pin ${m.title}`}
                  aria-pressed={!!m.pinned}
                  onClick={() => pin(m)}
                >
                  <Pin size={10} className={m.pinned ? 'text-yellow-400' : undefined} />
                </IconButton>
                <IconButton
                  size="sm" variant="danger" className="size-5 shrink-0"
                  label={`Delete ${m.title}`}
                  onClick={() => del(m.id)}
                >
                  <Trash2 size={10} />
                </IconButton>
              </div>
              {isOpen && (
                <div id={bodyId} className="border-t border-border px-2 pt-1.5 pb-2 text-[11px] whitespace-pre-wrap break-words text-muted">
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em]"
                    style={{ color: TYPE_COLORS[m.type] }}>{m.type}</span>
                  {' · '}{m.updated_at.slice(0, 10)}
                  <p className="m-0 mt-1">{m.content}</p>
                  {m.conflict_with_id != null && (
                    <p className="m-0 mt-1.5 font-semibold text-red-600">
                      May contradict: {memories.find(x => x.id === m.conflict_with_id)?.title ?? `memory #${m.conflict_with_id}`}
                    </p>
                  )}
                  {m.status === 'provisional' && (
                    <Button variant="primary" size="sm" className="mt-1.5" onClick={() => confirm(m.id)}>
                      Confirm — Arynwood got this right
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Chat() {
  const {
    activeModel, setActiveModel, activeServer,
    personas, activePersonaId, setActivePersonaId,
    conversations, setConversations,
    activeConversationId, setActiveConversationId,
  } = useAppStore()

  const activePersona = personas.find(p => p.id === activePersonaId)
  const assistantName = activePersona?.name ?? ARYNWOOD.name

  // Chat's title tracks the selected persona, so it overrides AppShell's
  // static route title rather than living in ROUTE_TITLES.
  usePageTitle(`Chat · ${assistantName}`)

  const selectPersona = (id: string) => {
    setActivePersonaId(id)
    const persona = personas.find(p => p.id === id)
    if (persona) setActiveModel(persona.model)
  }

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activityStatus, setActivityStatus] = useState('')
  const [streamBuffer, setStreamBuffer] = useState('')
  const [wsReady, setWsReady] = useState(false)
  const [actionLog, setActionLog] = useState<Record<number, ActionResult[]>>({}) // keyed by message id
  const [memRefresh, setMemRefresh] = useState(0)
  const [attachment, setAttachment]   = useState<{ name: string; text: string } | null>(null)
  const [uploading, setUploading]     = useState(false)
  // Set while the backend is paused mid-turn waiting on an approval decision
  // (roadmap 2.3) — the request is answered, not a new chat message, so it gets
  // its own state and its own send path (ChatSocket.sendApprovalResponse).
  const [pendingApproval, setPendingApproval] = useState<
    { requestId: string; tool: string; arguments: Record<string, unknown>; tier: string } | null
  >(null)
  const wsRef = useRef<ChatSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastMsgIdRef = useRef<number>(0)
  // context_used arrives BEFORE the reply streams (and therefore before the new
  // assistant message id exists — unlike memory_saved, which arrives after), so it
  // can't be keyed into actionLog right away. Buffered here and attached once the
  // 'token'+done branch below mints the real id.
  const pendingContextRef = useRef<ActionResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Ref so the WS callback always sees the latest conversation ID (avoids stale closure)
  const activeConvRef = useRef<number | null>(null)
  useEffect(() => { activeConvRef.current = activeConversationId }, [activeConversationId])

  const loadConversations = useCallback(async () => {
    try { setConversations(await getConversations()) } catch (err) { console.warn('Failed to load conversations:', err) }
  }, [setConversations])

  const loadMessages = useCallback(async (id: number | null) => {
    if (!id) return
    try { setMessages(await getMessages(id)) } catch (err) { console.warn('Failed to load messages:', err) }
  }, [])

  // Init WebSocket
  useEffect(() => {
    const ws = new ChatSocket(
      (msg) => {
        if (msg.type === 'conversation_id') {
          setActiveConversationId(msg.id)
          loadConversations()
        } else if (msg.type === 'status') {
          setActivityStatus(msg.label)
        } else if (msg.type === 'token') {
          setStreamBuffer(prev => prev + msg.token)
          setActivityStatus('')
          if (msg.done) {
            const newId = Date.now()
            lastMsgIdRef.current = newId
            setMessages(prev => [
              ...prev,
              { id: newId, conversation_id: activeConversationId ?? 0, role: 'assistant', content: '', created_at: '' },
            ])
            if (pendingContextRef.current) {
              const ctx = pendingContextRef.current
              pendingContextRef.current = null
              setActionLog(log => ({ ...log, [newId]: [ctx, ...(log[newId] ?? [])] }))
            }
            setStreamBuffer('')
            setStreaming(false)
            loadMessages(activeConvRef.current)
          }
        } else if (msg.type === 'context_used') {
          const parts: string[] = []
          if (msg.web_search) parts.push('web search')
          if (msg.kb_sources.length) parts.push(`${msg.kb_sources.length} knowledge source${msg.kb_sources.length === 1 ? '' : 's'}`)
          if (msg.tool_servers.length) parts.push(`ran tools on ${msg.tool_servers.join(', ')}`)
          if (!parts.length) return
          pendingContextRef.current = {
            name: `Used: ${parts.join(' · ')}`, ok: true, isContext: true,
            contextDetails: msg.kb_sources.map(s => {
              const pages = s.page_start ? ` (p.${s.page_start}${s.page_end && s.page_end !== s.page_start ? `-${s.page_end}` : ''})` : ''
              return `"${s.title}"${pages} — ${s.source} · match ${Math.round(s.score * 100)}%`
            }),
          }
        } else if (msg.type === 'memory_saved') {
          setMemRefresh(n => n + 1)
          setActionLog(log => ({
            ...log,
            [lastMsgIdRef.current]: [
              ...(log[lastMsgIdRef.current] ?? []),
              ...msg.items.map(m => ({
                name: m.conflict_with
                  ? `Remembered (⚠ may conflict with "${m.conflict_with}"): ${m.title}`
                  : `Remembered (needs your confirm): ${m.title}`,
                ok: !m.conflict_with, isMem: true,
              })),
            ],
          }))
        } else if (msg.type === 'action_result') {
          const result: ActionResult = { name: msg.name, ok: msg.ok, status: msg.status, response: msg.response, error: msg.error }
          if (lastMsgIdRef.current) {
            setActionLog(log => ({
              ...log,
              [lastMsgIdRef.current]: [...(log[lastMsgIdRef.current] ?? []), result],
            }))
          }
        } else if (msg.type === 'approval_request') {
          setPendingApproval({
            requestId: msg.request_id, tool: msg.tool, arguments: msg.arguments, tier: msg.tier,
          })
        } else if (msg.type === 'error') {
          setStreaming(false)
          setStreamBuffer('')
          setActivityStatus('')
        }
      },
      () => setWsReady(true),
      () => setWsReady(false),
    )
    ws.connect()
    wsRef.current = ws
    return () => ws.disconnect()
    // Deliberately mount-only — reconnecting the WS on every activeConversationId
    // change would drop the live stream when switching chats. The handler reads
    // the latest id via activeConvRef instead (see the ref-sync effect above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMessages(activeConversationId)
  }, [activeConversationId, loadMessages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamBuffer])

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const res = await uploadFile(file)
      setAttachment({ name: res.filename, text: res.text })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages(prev => [...prev, { id: Date.now(), conversation_id: activeConversationId ?? 0, role: 'assistant', content: `⚠️ Upload failed: ${msg}`, created_at: '' }])
    } finally {
      setUploading(false)
    }
  }

  const send = () => {
    if ((!input.trim() && !attachment) || streaming || !wsReady || pendingApproval) return
    const text = input.trim()
    const fullMessage = attachment
      ? `[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\`\n\n${text}`
      : text
    const displayText = attachment ? `📎 ${attachment.name}${text ? ` — ${text}` : ''}` : text
    setInput('')
    setAttachment(null)
    setStreaming(true)
    setActivityStatus('')
    setMessages(prev => [...prev, { id: Date.now(), conversation_id: activeConversationId ?? 0, role: 'user', content: displayText, created_at: '' }])
    wsRef.current?.send({
      message: fullMessage,
      persona: activePersonaId,
      model: activeModel,
      server_host: activeServer?.host ?? 'localhost',
      server_port: activeServer?.port ?? 11434,
      conversation_id: activeConversationId ?? undefined,
    })
  }

  const respondToApproval = (approved: boolean) => {
    if (!pendingApproval) return
    wsRef.current?.sendApprovalResponse(pendingApproval.requestId, approved)
    setPendingApproval(null)
  }

  const newChat = () => {
    // Abort any in-flight stream by bouncing the WebSocket
    wsRef.current?.disconnect()
    wsRef.current?.connect()
    setActiveConversationId(null)
    setMessages([])
    setStreaming(false)
    setStreamBuffer('')
    setInput('')
    setAttachment(null)
  }

  const canSend = (!!input.trim() || !!attachment) && !streaming && wsReady && !pendingApproval

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation sidebar */}
      <div className="flex w-55 shrink-0 flex-col overflow-hidden border-r border-border bg-surface">
        <div className="border-b border-border px-2.5 py-3">
          <Button
            onClick={newChat}
            className="w-full border-accent bg-accent/15 text-accent hover:bg-accent/25"
          >
            <Plus size={14} aria-hidden="true" /> New Chat
          </Button>
        </div>

        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-auto px-1.5 py-2">
          {conversations.length === 0 && (
            <p className="m-0 px-2 py-1 text-[11px] italic text-muted">No conversations yet.</p>
          )}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {conversations.map(c => {
              const active = activeConversationId === c.id
              const title = c.title ?? `Chat #${c.id}`
              return (
                <li key={c.id} className={cn(
                  'flex items-center gap-1 rounded-[7px] border px-1 transition-colors',
                  active ? 'border-border bg-surface2' : 'border-transparent hover:bg-surface2/50',
                )}>
                  <button
                    type="button"
                    onClick={() => setActiveConversationId(c.id)}
                    aria-current={active ? 'true' : undefined}
                    className="min-w-0 flex-1 cursor-pointer overflow-hidden border-none bg-transparent px-1.5 py-2 text-left"
                  >
                    <span className="block truncate text-xs text-text">{title}</span>
                    <span className="block truncate text-[10px] text-muted">{c.persona} · {c.model}</span>
                  </button>
                  <IconButton
                    size="sm" variant="danger" className="size-6 shrink-0"
                    label={`Delete ${title}`}
                    onClick={async () => {
                      await deleteConversation(c.id)
                      loadConversations()
                      if (activeConversationId === c.id) newChat()
                    }}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        </nav>

        <MemoryPanel refreshTrigger={memRefresh} />
        <AgentConfigPanel />
      </div>

      {/* Main chat */}
      <PageShell className="flex-1">
        {/* Persona picker — which persona (and its configured model) the next message goes to */}
        {personas.length > 0 && (
          <div role="group" aria-label="Persona" className="flex flex-wrap gap-1.5 px-6 pt-2.5">
            {personas.map(p => {
              const active = p.id === activePersonaId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPersona(p.id)}
                  title={p.role}
                  aria-pressed={active}
                  className={cn(
                    'cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-semibold transition-colors',
                    active ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-text',
                  )}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
        )}

        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-5">
          {messages.length === 0 && !streaming && (
            <EmptyState className="flex-1" title={`Start a conversation with ${assistantName}`} />
          )}
          {messages.map(m => {
            const mine = m.role === 'user'
            return (
              <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
                  {!mine && (
                    <span aria-hidden="true"
                      className="mt-0.5 mr-2.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: ARYNWOOD.color }}>
                      {assistantName[0]}
                    </span>
                  )}
                  <div className={cn(
                    'max-w-[72%] break-words rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed text-text',
                    mine ? 'rounded-br-[4px] bg-accent' : 'rounded-bl-[4px] bg-surface2',
                  )}>
                    {mine
                      ? <span className="whitespace-pre-wrap">{m.content}</span>
                      : <MarkdownMessage content={stripInternalBlocks(m.content)} />}
                  </div>
                </div>
                {/* Action result cards */}
                {m.role === 'assistant' && actionLog[m.id]?.map((a, i) => (
                  <div key={i} className="w-[72%] min-w-60 pl-[38px]">
                    <ActionCard result={a} />
                  </div>
                ))}
              </div>
            )
          })}

          {/* Streaming token */}
          {streaming && streamBuffer && (
            <div className="flex justify-start">
              <span aria-hidden="true"
                className="mt-0.5 mr-2.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: ARYNWOOD.color }}>
                {assistantName[0]}
              </span>
              <div className="max-w-[72%] break-words rounded-xl rounded-bl-[4px] bg-surface2 px-3.5 py-2.5 text-[13px] leading-relaxed text-text">
                <MarkdownMessage content={stripInternalBlocks(streamBuffer)} />
                <span aria-hidden="true" className="ml-0.5 opacity-50">▋</span>
              </div>
            </div>
          )}
          {streaming && !streamBuffer && (
            <p role="status" className="m-0 flex items-center gap-2 text-xs text-muted">
              <span aria-hidden="true" className="size-7 shrink-0 rounded-full" style={{ background: ARYNWOOD.color }} />
              <span>{activityStatus || 'Thinking...'}</span>
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <input ref={fileRef} type="file" className="hidden" onChange={pickFile}
          accept=".txt,.md,.py,.js,.ts,.jsx,.tsx,.json,.yaml,.yml,.csv,.log,.sh,.html,.css,.sql,.pdf,.docx,.toml,.ini,.cfg,.rs,.go,.java,.c,.cpp,.rb" />

        <div className="flex flex-col gap-2 border-t border-border bg-surface px-5 pt-2 pb-3">
          {pendingApproval && (
            <div role="alertdialog" aria-labelledby="approval-title"
              className="rounded-[10px] border border-danger/35 bg-danger/8 px-3.5 py-3">
              <div className="mb-1.5 flex items-baseline gap-2">
                <h2 id="approval-title" className="m-0 text-[13px] font-bold text-danger">Approval needed</h2>
                <span className="rounded border border-danger/40 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.04em] text-danger">
                  {pendingApproval.tier.replace('_', ' ')}
                </span>
              </div>
              <p className="m-0 mb-1 text-[12.5px] text-text">
                {assistantName} wants to run <code className="rounded bg-surface2 px-1.5 py-px font-mono">{pendingApproval.tool}</code>
              </p>
              {Object.keys(pendingApproval.arguments).length > 0 && (
                <pre className="m-0 mb-2.5 max-h-25 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface2 px-2 py-1.5 font-mono text-[11px] text-muted">
                  {JSON.stringify(pendingApproval.arguments, null, 2)}
                </pre>
              )}
              <div className="flex gap-2">
                <Button variant="danger" size="lg" className="text-[12.5px]" onClick={() => respondToApproval(true)}>
                  Approve
                </Button>
                <Button variant="secondary" size="lg" className="text-[12.5px]" onClick={() => respondToApproval(false)}>
                  Deny
                </Button>
              </div>
            </div>
          )}

          {attachment && (
            <div className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5">
              <Paperclip size={13} aria-hidden="true" className="shrink-0 text-accent" />
              <span className="flex-1 truncate text-xs text-accent">{attachment.name}</span>
              <IconButton size="sm" label="Remove attachment" className="size-5" onClick={() => setAttachment(null)}>
                <X size={13} />
              </IconButton>
            </div>
          )}

          <div className="flex items-end gap-2.5">
            <IconButton
              size="lg" variant="secondary"
              label={uploading ? 'Uploading file…' : 'Attach file'}
              onClick={() => fileRef.current?.click()}
              disabled={streaming || uploading}
            >
              <Paperclip size={16} />
            </IconButton>
            <div className="flex flex-1 items-end rounded-xl border border-border bg-surface2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                disabled={!!pendingApproval}
                aria-label={`Message ${assistantName}`}
                placeholder={pendingApproval ? 'Respond to the approval request above first…' : attachment ? 'Add a message or just send the file… (Enter)' : `Message ${assistantName}... (Enter to send, Shift+Enter for newline)`}
                rows={1}
                className="max-h-40 flex-1 resize-none overflow-auto rounded-xl border-none bg-transparent px-3.5 py-2.5 text-[13px] leading-normal text-text"
              />
            </div>
            <IconButton
              size="lg" variant={canSend ? 'primary' : 'secondary'}
              label="Send message" onClick={send} disabled={!canSend}
            >
              <Send size={16} />
            </IconButton>
          </div>
        </div>

        {/* WS status */}
        {!wsReady && (
          <p role="status" className="m-0 bg-danger/10 px-5 py-1 text-center text-[11px] text-danger">
            Connecting to backend...
          </p>
        )}
      </PageShell>
    </div>
  )
}

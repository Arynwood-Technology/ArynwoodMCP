import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Search, MessageSquarePlus, PanelLeft, Activity, RotateCcw,
  Cpu, User, History, Wrench, CornerDownLeft, type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAppStore } from '../../store/useAppStore'
import { NAV_DESTINATIONS } from './nav'
import {
  getModels, getConversations, restartBackend,
  type OllamaModel, type Conversation,
} from '../../lib/api'

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: LucideIcon
  /** Extra text to match against that isn't worth showing. */
  keywords?: string
  run: () => void
}

/** Rank: a prefix match beats a substring match beats a match on the supporting
 *  text, so typing "chat" surfaces the Chat page above things merely about chat. */
function score(cmd: Command, q: string): number {
  const label = cmd.label.toLowerCase()
  if (label.startsWith(q)) return 0
  if (label.includes(q)) return 1
  const rest = `${cmd.group} ${cmd.hint ?? ''} ${cmd.keywords ?? ''}`.toLowerCase()
  return rest.includes(q) ? 2 : -1
}

/** Everything stateful lives here rather than in CommandPalette, because Radix
 *  unmounts portal children while closed — so query, selection and fetched data
 *  reset on each open with no effect needed to clear them. */
function PaletteBody() {
  const setOpen           = useAppStore(s => s.setPaletteOpen)
  const toggleSidebar     = useAppStore(s => s.toggleSidebar)
  const setStatusDrawer   = useAppStore(s => s.setStatusDrawerOpen)
  const setActiveConvId   = useAppStore(s => s.setActiveConversationId)
  const setActivePersona  = useAppStore(s => s.setActivePersonaId)
  const setActiveModel    = useAppStore(s => s.setActiveModel)
  const personas          = useAppStore(s => s.personas)
  const tools             = useAppStore(s => s.tools)
  const activeServer      = useAppStore(s => s.activeServer)
  const canRestart        = useAppStore(s => s.status?.can_restart) !== false
  const storeConvs        = useAppStore(s => s.conversations)

  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [models, setModels] = useState<OllamaModel[]>([])
  // Seeded from the store so there's something to search before the fetch lands.
  const [convs, setConvs] = useState<Conversation[]>(storeConvs)
  const listRef = useRef<HTMLDivElement>(null)

  // Fetched on open rather than kept in the store, so the palette costs nothing
  // until it's used and never shows a stale model list.
  useEffect(() => {
    getConversations().then(setConvs).catch(() => {})
    getModels(activeServer?.host ?? 'localhost', activeServer?.port ?? 11434)
      .then(r => setModels(r.models ?? []))
      .catch(() => setModels([]))
  }, [activeServer])

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => { setOpen(false); fn() }

    return [
      // Actions
      {
        id: 'action:new-chat', group: 'Actions', label: 'New chat',
        icon: MessageSquarePlus, keywords: 'start conversation aryn',
        run: close(() => { setActiveConvId(null); navigate('/chat') }),
      },
      {
        id: 'action:status', group: 'Actions', label: 'Open system status',
        icon: Activity, keywords: 'health services gpu qdrant mcp sidecar',
        run: close(() => setStatusDrawer(true)),
      },
      {
        id: 'action:sidebar', group: 'Actions', label: 'Toggle sidebar',
        icon: PanelLeft, keywords: 'collapse expand nav',
        run: close(toggleSidebar),
      },
      ...(canRestart ? [{
        id: 'action:restart', group: 'Actions', label: 'Restart API backend',
        icon: RotateCcw, keywords: 'reload server uvicorn',
        run: close(() => { restartBackend().catch(() => {}) }),
      }] : []),

      // Pages
      ...NAV_DESTINATIONS.map(d => ({
        id: `page:${d.to}`, group: 'Pages', label: d.label, icon: d.icon,
        run: close(() => navigate(d.to)),
      })),

      // Personas — switching also adopts the persona's configured model, the
      // same coupling the Chat page's picker applies.
      ...personas.map(p => ({
        id: `persona:${p.id}`, group: 'Personas', label: p.name,
        hint: p.role, icon: User, keywords: p.model,
        run: close(() => {
          setActivePersona(p.id)
          if (p.model) setActiveModel(p.model)
          navigate('/chat')
        }),
      })),

      // Models
      ...models.map(m => ({
        id: `model:${m.name}`, group: 'Models', label: m.name, icon: Cpu,
        hint: activeServer ? `${activeServer.host}:${activeServer.port}` : undefined,
        run: close(() => setActiveModel(m.name)),
      })),

      // Recent conversations
      ...convs.slice(0, 12).map(c => ({
        id: `conv:${c.id}`, group: 'Recent conversations',
        label: c.title ?? `Chat #${c.id}`,
        hint: `${c.persona} · ${c.model}`, icon: History,
        run: close(() => { setActiveConvId(c.id); navigate('/chat') }),
      })),

      // Tools
      ...tools.map(t => ({
        id: `tool:${t.id}`, group: 'Tools', label: t.name,
        hint: t.category, icon: Wrench, keywords: t.description,
        run: close(() => navigate('/tools', { state: { openTool: t.id } })),
      })),
    ]
  }, [
    navigate, setOpen, setActiveConvId, setStatusDrawer, toggleSidebar,
    setActivePersona, setActiveModel, personas, models, convs, tools, activeServer, canRestart,
  ])

  // Filter, rank, and attach group headings in one pass — headings are derived
  // here rather than by mutating a variable during render.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const ranked = !q
      ? commands
      : commands
          .map((cmd, i) => ({ cmd, s: score(cmd, q), i }))
          .filter(r => r.s >= 0)
          .sort((a, b) => a.s - b.s || a.i - b.i)
          .map(r => r.cmd)

    return ranked.map((cmd, i) => ({
      cmd,
      heading: i === 0 || ranked[i - 1].group !== cmd.group ? cmd.group : null,
    }))
  }, [commands, query])

  // Clamp rather than reset, so narrowing the query keeps a valid selection.
  const active = results.length ? Math.min(cursor, results.length - 1) : 0

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    // Optional call: scrollIntoView is absent in jsdom, and keeping the
    // selection visible is a nicety, not something worth throwing over.
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active, results.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((Math.min(cursor, results.length - 1) + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((Math.min(cursor, results.length - 1) - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      results[active].cmd.run()
    }
  }

  return (
    <Dialog.Content
      aria-describedby={undefined}
      onKeyDown={onKeyDown}
      className="fixed left-1/2 top-[15vh] z-50 flex max-h-[70vh] w-[92vw] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
    >
      <Dialog.Title className="sr-only">Command palette</Dialog.Title>

      <div className="flex items-center gap-2.5 border-b border-border px-3.5">
        <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0) }}
          placeholder="Search pages, models, personas, conversations, tools…"
          aria-label="Search commands"
          aria-controls="command-results"
          aria-activedescendant={results.length ? `cmd-${results[active].cmd.id}` : undefined}
          className="flex-1 border-none bg-transparent py-3 text-sm text-text focus:outline-none"
        />
        <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
      </div>

      <div
        ref={listRef}
        id="command-results"
        role="listbox"
        aria-label="Commands"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {results.length === 0 && (
          <p className="m-0 px-3 py-6 text-center text-xs text-muted">
            Nothing matches “{query}”.
          </p>
        )}
        {results.map(({ cmd, heading }, i) => {
          const isActive = i === active
          const Icon = cmd.icon
          return (
            <div key={cmd.id}>
              {heading && (
                <p className="m-0 px-2.5 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                  {heading}
                </p>
              )}
              <div
                id={`cmd-${cmd.id}`}
                role="option"
                aria-selected={isActive}
                data-active={isActive}
                onClick={cmd.run}
                onMouseMove={() => setCursor(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-xs',
                  isActive ? 'bg-accent/15 text-text' : 'text-muted hover:text-text',
                )}
              >
                <Icon size={14} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-text">{cmd.label}</span>
                {cmd.hint && <span className="shrink-0 truncate text-[10px] text-muted">{cmd.hint}</span>}
                {isActive && <CornerDownLeft size={12} aria-hidden="true" className="shrink-0 text-muted" />}
              </div>
            </div>
          )
        })}
      </div>
    </Dialog.Content>
  )
}

export function CommandPalette() {
  const open    = useAppStore(s => s.paletteOpen)
  const setOpen = useAppStore(s => s.setPaletteOpen)

  // Global shortcut. Registered here rather than in AppShell so the open/close
  // toggle lives with the component it controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useAppStore.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <PaletteBody />
      </Dialog.Portal>
    </Dialog.Root>
  )
}

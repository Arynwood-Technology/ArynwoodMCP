import { Search } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

/** Presentational only — AppShell resolves the title and mounts this once for
 *  the whole app. It used to be imported and rendered separately by 12 pages,
 *  each passing its own title, which meant there was no single place to hang
 *  global chrome (command palette, status drawer, job center). */
export function TopBar({ title }: { title: string }) {
  const activeModel = useAppStore(s => s.activeModel)
  const setActiveModel = useAppStore(s => s.setActiveModel)
  const status = useAppStore(s => s.status)
  const setPaletteOpen = useAppStore(s => s.setPaletteOpen)
  const setStatusDrawerOpen = useAppStore(s => s.setStatusDrawerOpen)
  const gpu = status?.gpu

  return (
    <header className="flex h-13 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
      <h1 className="m-0 text-[15px] font-semibold text-text">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface2 py-1 pl-2 pr-1.5 text-[11px] text-muted transition-colors hover:border-accent hover:text-text"
        >
          <Search size={12} aria-hidden="true" />
          <span>Search</span>
          <kbd className="rounded border border-border px-1 py-px font-sans text-[10px]">⌘K</kbd>
        </button>

        {gpu?.available && (
          // Doubles as the entry point to the full GPU/queue breakdown, so the
          // number here is a summary of the drawer rather than a rival to it.
          <button
            type="button"
            onClick={() => setStatusDrawerOpen(true)}
            title={`${gpu.name ?? 'GPU'} — ${gpu.utilization}% utilisation, ${gpu.memory_used}MB of ${gpu.memory_total}MB in use. Open system status.`}
            className="cursor-pointer rounded border border-transparent bg-accent2/10 px-2 py-0.5 text-[11px] text-accent2 transition-colors hover:border-accent2/40"
          >
            GPU {gpu.utilization}% · {gpu.memory_used}MB
          </button>
        )}

        <input
          value={activeModel}
          onChange={e => setActiveModel(e.target.value)}
          placeholder="model name"
          aria-label="Active model"
          title={activeModel}
          className="w-44 rounded-md border border-border bg-surface2 px-2 py-1 text-xs text-text"
        />
      </div>
    </header>
  )
}

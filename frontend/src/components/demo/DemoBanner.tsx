import { useState } from 'react'
import { Sparkles, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'

// Product page on arynwood.com: download, requirements and setup help in one place.
const SITE_URL = 'https://arynwood.com/mcp/'

/** Persistent, honest label that this is simulated data, not a real AI backend — rendered
 *  once in AppShell, above TopBar, outside <Outlet/> so it survives every navigation.
 *  Collapsible for the session (local state only — never written to localStorage), so it
 *  always reappears on a fresh page load rather than being dismissible forever. */
export function DemoBanner() {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full shrink-0 items-center justify-center gap-1 border-b border-border bg-accent/10 py-0.5 text-[10px] text-accent hover:bg-accent/15"
      >
        <Sparkles size={10} /> Demo <ChevronDown size={10} />
      </button>
    )
  }

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-accent/10 px-3 py-1.5 text-[11px] text-text">
      <Sparkles size={12} className="shrink-0 text-accent" />
      <span>
        <strong className="font-semibold">Demo</strong>: simulated data, not a real AI backend.
      </span>
      <a
        href={SITE_URL}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
      >
        Get the real thing <ExternalLink size={10} />
      </a>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        aria-label="Collapse demo banner"
        className="ml-1 text-muted hover:text-text"
      >
        <ChevronUp size={12} />
      </button>
    </div>
  )
}

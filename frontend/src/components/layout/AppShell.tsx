import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { StatusDrawer } from './StatusDrawer'
import { PageErrorBoundary } from './PageErrorBoundary'
import { DesignCenter } from '../../pages/DesignCenter'
import { useAppStore } from '../../store/useAppStore'
import { getServers, getTools, getPersonas, getStatus } from '../../lib/api'

/** Default TopBar titles by route. A page whose title depends on state calls
 *  usePageTitle() instead of appearing here (see Chat). */
const ROUTE_TITLES: Record<string, string> = {
  '/':          'Dashboard',
  '/chat':      'Chat',
  '/knowledge': 'Knowledge',
  '/models':    'Model Manager',
  '/servers':   'Server Connections',
  '/tools':     'Tool Library',
  '/publish':   'Publish',
  '/design':    'Design Center',
  '/studio':    'Music Studio',
  '/dj':        'DJ Toolkit',
  '/video':     'Video Studio',
  '/social':    'Social Media',
}

const STATUS_POLL_MS = 10_000

/** The one place global chrome lives. Everything outside <Outlet/> persists
 *  across navigation, which is what makes a command palette, status drawer or
 *  job center possible — none of which had a host before this existed. */
export function AppShell() {
  const { setServers, setTools, setActiveServer, setPersonas, setStatus } = useAppStore()
  const pageTitle = useAppStore(s => s.pageTitle)
  const location = useLocation()

  // Design Center stays mounted at all times to preserve its iframe state, and
  // renders without a top bar — it supplies its own chrome.
  const onDesign = location.pathname === '/design'
  const title = pageTitle ?? ROUTE_TITLES[location.pathname] ?? 'Arynwood'

  useEffect(() => {
    // Bootstrap global data; auto-select Local Ollama as default server.
    getServers().then(list => {
      setServers(list)
      const local = list.find(s => s.id === 1) ?? list[0]
      if (local) setActiveServer(local)
    }).catch(() => {})
    getTools().then(setTools).catch(() => {})
    getPersonas().then(setPersonas).catch(() => {})
  }, [setServers, setTools, setActiveServer, setPersonas])

  // Owned by the shell rather than by Dashboard: the sidebar's connectivity dot
  // and the top bar's GPU chip are visible on every page, but used to update
  // only while Dashboard was mounted — so they sat stale (or blank on a deep
  // link) everywhere else.
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const s = await getStatus()
        if (!cancelled) setStatus(s)
      } catch { /* a down backend is already surfaced by the status dot */ }
    }
    poll()
    const id = setInterval(poll, STATUS_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [setStatus])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!onDesign && <TopBar title={title} />}
        <main className="relative min-h-0 flex-1">
          <div className={onDesign ? 'absolute inset-0' : 'hidden'}>
            <DesignCenter />
          </div>
          <div className={onDesign ? 'hidden' : 'h-full'}>
            {/* Keyed by route so navigating away from a crashed page clears the
                error — previously the boundary latched until a full reload. */}
            <PageErrorBoundary key={location.pathname}>
              <Outlet />
            </PageErrorBoundary>
          </div>
        </main>
      </div>

      {/* Global overlays. They live here, not in a page, so Ctrl/Cmd+K and the
          status drawer work identically on every route. */}
      <CommandPalette />
      <StatusDrawer />
    </div>
  )
}

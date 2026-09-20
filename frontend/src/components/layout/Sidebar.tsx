import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useAppStore } from '../../store/useAppStore'
import { NAV } from './nav'

const ITEM = 'flex items-center rounded-[10px] transition-colors no-underline'
const ACTIVE = 'bg-accent/12 text-accent'
const IDLE = 'text-muted hover:text-text hover:bg-surface2'

/** Below this the labelled sidebar eats too much of the viewport, so the rail is
 *  forced regardless of the saved preference. */
const NARROW = '(max-width: 900px)'

function Label({ children, show }: { children: React.ReactNode; show: boolean }) {
  // Rendered in both modes so the accessible name never depends on layout; the
  // rail just clips it visually.
  return <span className={show ? 'truncate text-xs font-medium' : 'sr-only'}>{children}</span>
}

function NavBtn({ to, icon: Icon, label, expanded, nested = false, also }: {
  to: string; icon: LucideIcon; label: string; expanded: boolean; nested?: boolean; also?: string[]
}) {
  const { pathname } = useLocation()
  const inAlso = !!also?.some(p => pathname === p || pathname.startsWith(p + '/'))
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={expanded ? undefined : label}
      className={({ isActive }) => cn(
        ITEM,
        expanded ? 'h-9 w-full gap-2.5 px-2.5' : 'size-11 justify-center',
        nested && expanded && 'pl-7',
        nested && !expanded && 'size-9 border border-border',
        isActive || inAlso ? ACTIVE : cn(IDLE, nested && !expanded && 'bg-bg'),
      )}
    >
      {({ isActive }) => (
        <>
          <Icon size={nested && !expanded ? 16 : 20} aria-hidden="true" className="shrink-0" />
          <Label show={expanded}>{label}{isActive || inAlso ? ' (current page)' : ''}</Label>
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const status           = useAppStore(s => s.status)
  const savedExpanded    = useAppStore(s => s.sidebarExpanded)
  const toggleSidebar    = useAppStore(s => s.toggleSidebar)
  const setStatusDrawer  = useAppStore(s => s.setStatusDrawerOpen)
  const location = useLocation()
  const narrow   = useMediaQuery(NARROW)

  // Narrow viewports always get the rail; the saved preference is remembered and
  // reapplied as soon as there's room for it again.
  const expanded = savedExpanded && !narrow

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    NAV.forEach(item => {
      if (item.kind === 'group') {
        const childActive = item.children.some(c => location.pathname === c.to)
        if (childActive) setOpenGroups(prev => ({ ...prev, [item.label]: true }))
      }
    })
  }, [location.pathname])

  const toggleGroup = (label: string) =>
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }))

  const online = !!status?.ollama

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex shrink-0 flex-col gap-1 border-r border-border bg-surface pt-4 transition-[width] duration-150',
        expanded ? 'w-56 items-stretch px-2' : 'w-16 items-center',
      )}
    >
      {/* Brand + collapse control */}
      <div className={cn('mb-4 flex items-center', expanded ? 'gap-2 px-0.5' : 'flex-col gap-1')}>
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent text-base font-bold text-white"
        >
          A
        </span>
        {expanded && <span className="flex-1 truncate text-sm font-semibold text-text">Arynwood</span>}
        {!narrow && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className={cn(ITEM, IDLE, 'shrink-0 cursor-pointer justify-center border-none bg-transparent', expanded ? 'size-8' : 'size-9')}
          >
            {expanded
              ? <PanelLeftClose size={16} aria-hidden="true" />
              : <PanelLeftOpen size={16} aria-hidden="true" />}
          </button>
        )}
      </div>

      {NAV.map(item => {
        if (item.kind !== 'group') {
          return <NavBtn key={item.to} to={item.to} icon={item.icon} label={item.label} expanded={expanded} also={item.also} />
        }

        const childActive = item.children.some(c => location.pathname === c.to)
        const open = openGroups[item.label] ?? false
        const Icon = item.icon
        const panelId = `nav-group-${item.label.replace(/\W+/g, '-').toLowerCase()}`

        return (
          <div key={item.label} className={cn('flex flex-col gap-0.5', expanded ? 'items-stretch' : 'items-center')}>
            <button
              type="button"
              title={expanded ? undefined : item.label}
              aria-label={item.label}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggleGroup(item.label)}
              className={cn(
                ITEM, 'relative cursor-pointer border-none bg-transparent',
                expanded ? 'h-9 w-full gap-2.5 px-2.5' : 'size-11 justify-center',
                childActive ? ACTIVE : IDLE,
              )}
            >
              <Icon size={20} aria-hidden="true" className="shrink-0" />
              <Label show={expanded}>{item.label}</Label>
              <ChevronDown
                size={expanded ? 14 : 9}
                aria-hidden="true"
                className={cn(
                  'shrink-0 text-muted transition-transform',
                  expanded ? 'ml-auto' : 'absolute right-1 bottom-1',
                  open && 'rotate-180',
                )}
              />
            </button>
            <div
              id={panelId}
              className={cn('flex flex-col gap-0.5', expanded ? 'items-stretch' : 'items-center', !open && 'hidden')}
            >
              {item.children.map(child => (
                <NavBtn key={child.to} to={child.to} icon={child.icon} label={child.label} expanded={expanded} nested />
              ))}
            </div>
          </div>
        )
      })}

      {/* Connectivity — opens the full status drawer rather than only tooltipping. */}
      <button
        type="button"
        onClick={() => setStatusDrawer(true)}
        title={online ? 'Ollama online — open system status' : 'Ollama offline — open system status'}
        aria-label={`System status: Ollama ${online ? 'online' : 'offline'}`}
        className={cn(
          ITEM, IDLE, 'mt-auto mb-3 cursor-pointer border-none bg-transparent',
          expanded ? 'h-9 gap-2.5 px-2.5' : 'size-11 justify-center',
        )}
      >
        <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', online ? 'bg-success' : 'bg-danger')} />
        <Label show={expanded}>System status</Label>
      </button>
    </nav>
  )
}

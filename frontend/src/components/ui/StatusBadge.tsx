import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'

const SHELL =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface2 px-2.5 py-1 ' +
  'text-[11px] text-text no-underline'
const INTERACTIVE = 'cursor-pointer transition-colors hover:border-accent'

function Dot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-success' : 'bg-danger')}
    />
  )
}

export interface StatusBadgeProps {
  online: boolean
  label: string
  /** Internal route — renders a real <Link>, so middle-click and Cmd-click work. */
  to?: string
  /** External URL — renders a real <a target="_blank">. */
  href?: string
  className?: string
}

/** Service up/down pill. Was a clickable <div> with mouse-only hover handlers;
 *  now renders whichever element actually matches the behaviour, so it is
 *  keyboard-reachable and announces its state. */
export function StatusBadge({ online, label, to, href, className }: StatusBadgeProps) {
  const state = `${label}: ${online ? 'online' : 'offline'}`
  const body = (
    <>
      <Dot online={online} />
      <span>{label}</span>
    </>
  )

  if (to) {
    return (
      <Link to={to} aria-label={state} className={cn(SHELL, INTERACTIVE, className)}>
        {body}
      </Link>
    )
  }
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={state}
        className={cn(SHELL, INTERACTIVE, className)}
      >
        {body}
      </a>
    )
  }
  return (
    <span role="status" aria-label={state} className={cn(SHELL, className)}>
      {body}
    </span>
  )
}

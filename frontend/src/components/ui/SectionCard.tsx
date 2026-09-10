import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface SectionCardProps {
  title?: ReactNode
  /** Right-aligned slot in the header row — actions, counts, status. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function SectionCard({
  title, actions, children, className, bodyClassName,
}: SectionCardProps) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
          {title && <h2 className="m-0 text-xs font-bold text-text">{title}</h2>}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('p-3.5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Small all-caps label used above ungrouped content (e.g. "Quick links"). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn(
      'm-0 mb-2.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted',
      className,
    )}>
      {children}
    </h2>
  )
}

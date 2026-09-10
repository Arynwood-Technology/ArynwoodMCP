import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** Fills the height AppShell hands a page, and establishes the column flex
 *  context that PageBar/PageBody rely on. `min-h-0` is load-bearing: without
 *  it a flex child with overflow refuses to shrink and the page scrolls as a
 *  whole instead of scrolling its body. */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>{children}</div>
  )
}

/** Fixed strip directly under the global TopBar — filters, tabs, status. */
export function PageBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2',
      className,
    )}>
      {children}
    </div>
  )
}

/** The single scrolling region of a page. */
export function PageBody({
  children, className, padded = true,
}: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-auto', padded && 'p-4', className)}>
      {children}
    </div>
  )
}

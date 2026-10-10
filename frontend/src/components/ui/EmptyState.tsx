import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface EmptyStateProps {
  /** Usually a lucide icon or an emoji. Decorative — the text carries meaning. */
  icon?: ReactNode
  /** Classes for the icon's wrapper, e.g. to lift the default dimming off a brand mark. */
  iconClassName?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, iconClassName, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className,
    )}>
      {icon && <div aria-hidden="true" className={cn('text-muted opacity-70', iconClassName)}>{icon}</div>}
      <p className="m-0 text-[13px] text-muted">{title}</p>
      {description && (
        <p className="m-0 max-w-sm text-[13px] leading-relaxed text-muted opacity-80">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

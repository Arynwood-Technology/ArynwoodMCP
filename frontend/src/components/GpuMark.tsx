import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/cn'

/** The mark on a feature that needs an NVIDIA GPU. Shown while CPU mode is on: one program
 *  runs everywhere, and what a computer can't run is marked rather than hidden. */
export function GpuMark({ className }: { className?: string }) {
  return (
    <span title="Needs an NVIDIA GPU. CPU mode is on."
      className={cn('rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#76b900] bg-[#76b900]/10', className)}>
      GPU
    </span>
  )
}

/** Shown at the top of a GPU-only feature while CPU mode is on: what's off, and what bridges it. */
export function CpuModeNotice({ feature, children }: { feature: string; children?: ReactNode }) {
  return (
    <div role="note" className="mb-4 rounded-lg border border-border bg-surface2 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
      <strong className="text-text">{feature} needs an NVIDIA GPU, and CPU mode is on.</strong>{' '}
      {children}{children ? ' ' : ''}
      <Link to="/tools" className="text-accent no-underline">CPU mode is set in Tools.</Link>
    </div>
  )
}

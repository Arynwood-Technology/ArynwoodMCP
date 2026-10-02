import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'

// The hand-drawn tree, used exactly as drawn (black on transparent). Every glow is CSS
// layered underneath it in index.css (.aw-mark), so the drawing stays the single source.
const TREE_URL = new URL('../../assets/arynwood-tree.png', import.meta.url).href

export interface ArynwoodMarkProps {
  /** Pixel size, or any CSS length. */
  size?: number | string
  /** orb: lit from within. eclipse: dark inside, light around the rim (waiting, offline). */
  variant?: 'orb' | 'eclipse'
  /** calm: a slow swell. thinking: a quicker pulse while a reply is on its way. */
  breathe?: 'calm' | 'thinking'
  /** When set, the mark is announced with this name; otherwise it's decorative. */
  label?: string
  className?: string
}

export function ArynwoodMark({ size = 40, variant = 'orb', breathe, label, className }: ArynwoodMarkProps) {
  return (
    <span
      className={cn('aw-mark', variant === 'eclipse' && 'aw-mark--eclipse', breathe && `aw-mark--${breathe}`, className)}
      style={{ '--aw-size': typeof size === 'number' ? `${size}px` : size } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="aw-mark__under" />
      <span className="aw-mark__halo" />
      <span className="aw-mark__core" />
      <img className="aw-mark__tree" src={TREE_URL} alt="" draggable={false} />
    </span>
  )
}

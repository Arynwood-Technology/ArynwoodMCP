import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes so later ones win over earlier conflicts —
 *  `cn('px-2', 'px-4')` yields `px-4`, not both. Lets a caller override a
 *  primitive's built-in classes via its `className` prop without !important. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

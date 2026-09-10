import type { VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { iconButtonVariants } from './variants'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Required. Icon-only controls have no accessible name otherwise — this
   *  becomes both the `aria-label` and the hover tooltip. The type makes it
   *  impossible to add a new unlabelled icon button. */
  label: string
  children: ReactNode
}

export function IconButton({
  className, variant, size, label, type = 'button', ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

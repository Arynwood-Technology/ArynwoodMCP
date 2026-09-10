import { cva } from 'class-variance-authority'

/** Kept out of Button.tsx so that file only exports components — a file mixing
 *  component and non-component exports breaks React Fast Refresh. Import this
 *  directly to style a non-button (a <Link>, say) to match a Button. */
export const buttonVariants = cva(
  // Base: real <button> semantics, consistent hit area, visible disabled state.
  'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold whitespace-nowrap ' +
    'transition-colors cursor-pointer border ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white border-transparent hover:bg-accent/85',
        secondary: 'bg-surface2 text-text border-border hover:border-accent',
        ghost: 'bg-transparent text-muted border-transparent hover:text-text hover:bg-surface2',
        outline: 'bg-transparent text-text border-border hover:border-accent',
        danger: 'bg-danger text-white border-transparent hover:bg-danger/85',
      },
      size: {
        sm: 'h-7 px-2.5 text-[11px]',
        md: 'h-8 px-3 text-xs',
        lg: 'h-10 px-4 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white border-transparent hover:bg-accent/85',
        secondary: 'bg-surface2 text-muted border-border hover:text-text hover:border-accent',
        ghost: 'bg-transparent text-muted border-transparent hover:text-text hover:bg-surface2',
        danger: 'bg-transparent text-muted border-transparent hover:text-danger hover:bg-danger/10',
      },
      size: {
        sm: 'size-7',
        md: 'size-9',
        lg: 'size-10',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

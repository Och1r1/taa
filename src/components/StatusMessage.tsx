import type { ReactNode } from 'react'

type Variant = 'error' | 'warning'

const VARIANTS: Record<Variant, string> = {
  error: 'border-pink/40 bg-pink/10 text-pink',
  warning: 'border-amber/40 bg-amber/10 text-amber',
}

interface Props {
  variant?: Variant
  className?: string
  children: ReactNode
}

/** Shared inline banner for form/list errors and warnings. */
export function StatusMessage({ variant = 'error', className = '', children }: Props) {
  return (
    <p className={`rounded-xl border px-4 py-3 text-sm ${VARIANTS[variant]} ${className}`}>
      {children}
    </p>
  )
}

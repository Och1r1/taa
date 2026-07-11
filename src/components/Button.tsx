import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'subtle'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-pink to-purple text-white shadow-lg shadow-purple/25 hover:brightness-110',
  ghost:
    'bg-transparent text-ink-soft border border-border hover:border-cyan/60 hover:text-ink',
  subtle: 'bg-raised text-ink-soft hover:bg-border/60',
}

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold
        transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

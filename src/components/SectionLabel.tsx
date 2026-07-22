import type { ReactNode } from 'react'

interface Props {
  className?: string
  children: ReactNode
}

/** Uppercase section heading shared by category/pack/settings blocks. */
export function SectionLabel({ className = '', children }: Props) {
  return (
    <div className={`text-xs font-bold uppercase tracking-widest text-muted-2 ${className}`}>
      {children}
    </div>
  )
}

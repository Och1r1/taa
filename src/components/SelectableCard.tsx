import type { ReactNode } from 'react'

interface Props {
  selected: boolean
  disabled?: boolean
  accent?: string
  badge?: ReactNode
  onSelect?: () => void
  className?: string
  children: ReactNode
}

/** Shared tile shell for category/pack pickers — border/bg/accent logic lives once. */
export function SelectableCard({
  selected,
  disabled = false,
  accent,
  badge,
  onSelect,
  className = '',
  children,
}: Props) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      className={`relative flex flex-col gap-1 rounded-2xl border-2 p-4 text-left transition
        ${
          disabled
            ? 'cursor-not-allowed border-border/50 bg-surface/40 opacity-60'
            : selected
              ? 'border-transparent bg-raised'
              : 'border-border bg-surface hover:bg-raised'
        } ${className}`}
      style={selected && accent ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}55` } : undefined}
    >
      {children}
      {badge && (
        <span className="absolute right-3 top-3 rounded-full bg-raised px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-2">
          {badge}
        </span>
      )}
    </button>
  )
}

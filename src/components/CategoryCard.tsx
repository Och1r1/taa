interface Props {
  icon: string
  title: string
  subtitle: string
  accent: string
  active: boolean
  selected?: boolean
  onSelect?: () => void
}

/** A category tile on the home screen. Inactive tiles show a "Тун удахгүй" badge. */
export function CategoryCard({
  icon,
  title,
  subtitle,
  accent,
  active,
  selected = false,
  onSelect,
}: Props) {
  return (
    <button
      disabled={!active}
      onClick={onSelect}
      className={`relative flex flex-col gap-3 rounded-2xl border-2 p-5 text-left transition
        ${
          active
            ? selected
              ? 'border-transparent bg-raised'
              : 'border-border bg-surface hover:bg-raised'
            : 'cursor-not-allowed border-border/50 bg-surface/40 opacity-60'
        }`}
      style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}55` } : undefined}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
        style={{ backgroundColor: `${accent}1a` }}
      >
        {icon}
      </span>
      <div>
        <div className="text-lg font-bold text-ink" style={{ color: '#f2f4f8' }}>
          {title}
        </div>
        <div className="text-sm text-muted" style={{ color: '#8b93a7' }}>
          {subtitle}
        </div>
      </div>
      {!active && (
        <span className="absolute right-3 top-3 rounded-full bg-raised px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-2">
          Тун удахгүй
        </span>
      )}
      {selected && (
        <span
          className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white"
          style={{ backgroundColor: accent }}
        >
          Сонгосон
        </span>
      )}
    </button>
  )
}

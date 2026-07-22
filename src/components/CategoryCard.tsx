import { SelectableCard } from './SelectableCard'

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
    <SelectableCard
      selected={selected}
      disabled={!active}
      accent={accent}
      onSelect={onSelect}
      className="gap-3 p-5"
      badge={!active ? 'Тун удахгүй' : undefined}
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
      {selected && (
        <span
          className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white"
          style={{ backgroundColor: accent }}
        >
          Сонгосон
        </span>
      )}
    </SelectableCard>
  )
}

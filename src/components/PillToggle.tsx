interface Option<T extends string | number> {
  value: T
  label: string
}

interface Props<T extends string | number> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  background?: 'base' | 'surface'
  className?: string
}

/** Shared pill-group control — mode/visibility toggles and rounds/time pickers all use this shell. */
export function PillToggle<T extends string | number>({
  options,
  value,
  onChange,
  background = 'base',
  className = '',
}: Props<T>) {
  return (
    <div
      className={`inline-flex rounded-xl border border-border p-1 ${
        background === 'surface' ? 'bg-surface' : 'bg-base'
      } ${className}`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            value === opt.value ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

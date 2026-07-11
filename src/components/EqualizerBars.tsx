interface Props {
  active?: boolean
  className?: string
}

const BARS = [
  { color: '#ec4899', delay: '0s' },
  { color: '#a855f7', delay: '0.15s' },
  { color: '#22d3ee', delay: '0.3s' },
  { color: '#6366f1', delay: '0.45s' },
]

/** Animated 3–4 bar equalizer — the "now playing" motif from the mockup. */
export function EqualizerBars({ active = true, className = '' }: Props) {
  return (
    <div className={`flex h-8 items-end gap-1 ${className}`}>
      {BARS.map((bar, i) => (
        <span
          key={i}
          className={active ? 'eq-bar w-1.5 rounded-full' : 'w-1.5 rounded-full'}
          style={{
            backgroundColor: bar.color,
            height: active ? undefined : '25%',
            animationDelay: bar.delay,
          }}
        />
      ))}
    </div>
  )
}

interface Props {
  timeLeft: number
  total: number
}

/** Countdown bar with color shifting from cyan → amber → pink as time runs out. */
export function TimerBar({ timeLeft, total }: Props) {
  const fraction = Math.max(0, Math.min(1, timeLeft / total))
  const pct = fraction * 100
  const color = fraction > 0.5 ? '#22d3ee' : fraction > 0.25 ? '#f59e0b' : '#ec4899'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-widest text-muted-2">
        <span>ХУГАЦАА</span>
        <span style={{ color }}>{Math.ceil(timeLeft)}с</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

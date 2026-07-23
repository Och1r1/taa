import type { AnswerOption } from '../types'

interface Props {
  option: AnswerOption
  index: number
  disabled: boolean
  revealed: boolean
  isAnswer: boolean
  isPicked: boolean
  /** Removed by a hint (Сэжүүр) — shown struck-through and unclickable. */
  eliminated?: boolean
  onPick: (songId: string) => void
}

const SHAPES = ['◆', '●', '▲', '■']
const SHAPE_COLORS = ['#ec4899', '#22d3ee', '#f59e0b', '#a855f7']

export function OptionCard({
  option,
  index,
  disabled,
  revealed,
  isAnswer,
  isPicked,
  eliminated = false,
  onPick,
}: Props) {
  let state = 'idle'
  if (revealed) {
    if (isAnswer) state = 'correct'
    else if (isPicked) state = 'wrong'
    else state = 'dim'
  } else if (eliminated) {
    state = 'dim'
  }

  const stateClass = {
    idle: 'border-border bg-surface hover:border-cyan/60 hover:bg-raised',
    correct: 'border-accent-green bg-accent-green/10 text-ink',
    wrong: 'border-pink bg-pink/10 text-ink',
    dim: 'border-border bg-surface opacity-40',
  }[state]

  return (
    <button
      disabled={disabled || eliminated}
      onClick={() => onPick(option.songId)}
      aria-label={`${index + 1}. ${option.title}`}
      className={`group flex w-full items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left
        text-ink transition disabled:cursor-default ${stateClass}`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
        style={{
          color: SHAPE_COLORS[index % 4],
          backgroundColor: `${SHAPE_COLORS[index % 4]}1a`,
        }}
      >
        <span aria-hidden="true">{SHAPES[index % 4]}</span>
      </span>
      <span
        className="text-base font-semibold"
        style={{ color: '#ffffff', textDecoration: eliminated && !revealed ? 'line-through' : 'none' }}
      >
        {option.title}
      </span>
      {revealed && isAnswer && <span className="ml-auto text-accent-green">✓</span>}
      {revealed && isPicked && !isAnswer && <span className="ml-auto text-pink">✕</span>}
    </button>
  )
}

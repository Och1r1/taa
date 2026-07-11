import type { RoundResult } from '../types'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'

interface Props {
  score: number
  results: RoundResult[]
  onPlayAgain: () => void
  onHome: () => void
}

export function ResultsScreen({ score, results, onPlayAgain, onHome }: Props) {
  const correctCount = results.filter((r) => r.correct).length
  const maxScore = results.length * 1000

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-14">
      <div className="flex flex-col items-center text-center animate-fade-up">
        <EqualizerBars className="mb-6 h-10" />
        <div className="text-sm font-bold uppercase tracking-widest text-muted-2">
          Тоглоом дууслаа
        </div>
        <div className="mt-3 bg-gradient-to-r from-pink via-purple to-cyan bg-clip-text text-6xl font-black text-transparent">
          {score.toLocaleString()}
        </div>
        <div className="mt-2 text-muted">
          {correctCount} / {results.length} зөв · дээд оноо {maxScore.toLocaleString()}
        </div>
      </div>

      {/* Round breakdown */}
      <div className="mt-10">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-2">
          Онооны самбар
        </div>
        <div className="space-y-2">
          {results.map((r) => (
            <div
              key={r.roundIndex}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <span className="text-xs font-bold text-muted-2">Р{r.roundIndex + 1}</span>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  r.correct ? 'bg-accent-green/15 text-accent-green' : 'bg-pink/15 text-pink'
                }`}
              >
                {r.correct ? '✓' : '✕'}
              </span>
              <span className="truncate text-sm text-ink-soft">{r.answerTitle}</span>
              <span className="ml-auto text-sm font-bold text-cyan">
                +{r.points.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button onClick={onPlayAgain} className="flex-1">
          ↻ Дахин тоглох
        </Button>
        <Button variant="ghost" onClick={onHome} className="flex-1">
          Нүүр хуудас
        </Button>
      </div>
    </div>
  )
}

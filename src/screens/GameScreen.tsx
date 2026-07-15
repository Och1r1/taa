import type { GameEngine } from '../game/useGameEngine'
import type { RoundOutcome } from '../types'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { MediaStage } from '../components/MediaStage'
import { OptionCard } from '../components/OptionCard'
import { TimerBar } from '../components/TimerBar'

interface Props {
  engine: GameEngine
  onQuit: () => void
}

const OUTCOME_LABEL: Record<RoundOutcome, string> = {
  correct: 'Зөв!',
  wrong: 'Буруу байна',
  timeout: 'Хугацаа дууслаа',
  skipped: 'Алгассан',
}

export function GameScreen({ engine, onQuit }: Props) {
  const {
    phase,
    config,
    round,
    roundIndex,
    timeLeft,
    score,
    lastResult,
    pickedSongId,
    hintUsedThisRound,
    eliminatedOptionId,
    answer,
    hint,
    skip,
    next,
    reset,
    error,
  } = engine

  if (phase === 'loading') {
    return (
      <Centered>
        <EqualizerBars className="mb-4 h-10" />
        <p className="text-muted">Дуунуудыг ачааллаж байна…</p>
      </Centered>
    )
  }

  if (phase === 'error') {
    return (
      <Centered>
        <div className="mb-2 text-2xl">⚠</div>
        <p className="mb-6 max-w-md text-center text-pink">{error}</p>
        <Button variant="ghost" onClick={() => { reset(); onQuit() }}>
          Нүүр хуудас руу буцах
        </Button>
      </Centered>
    )
  }

  if (!round) return null

  const revealed = phase === 'revealed'

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold tracking-widest text-muted-2">РАУНД</div>
          <div className="text-lg font-extrabold">
            {roundIndex + 1}
            <span className="text-muted"> / {config.rounds}</span>
          </div>
        </div>
        <button onClick={() => { reset(); onQuit() }} className="text-sm text-muted hover:text-ink">
          Гарах
        </button>
        <div className="text-right">
          <div className="text-xs font-bold tracking-widest text-muted-2">ОНОО</div>
          <div className="text-lg font-extrabold text-cyan">{score.toLocaleString()}</div>
        </div>
      </div>

      {/* Timer */}
      <div className="mb-8">
        <TimerBar timeLeft={timeLeft} total={config.timePerRound} />
      </div>

      {/* Media (audio / video / image) */}
      <MediaStage item={round.answer} revealed={revealed} />

      {/* Options */}
      <div className="grid gap-3 sm:grid-cols-2">
        {round.options.map((opt, i) => (
          <OptionCard
            key={opt.songId}
            option={opt}
            index={i}
            disabled={revealed}
            revealed={revealed}
            isAnswer={opt.songId === round.answer.id}
            isPicked={opt.songId === pickedSongId}
            eliminated={opt.songId === eliminatedOptionId}
            onPick={answer}
          />
        ))}
      </div>

      {/* Hint + Skip */}
      {!revealed && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={hint}
            disabled={hintUsedThisRound}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-ink-soft transition hover:border-amber/60 disabled:cursor-not-allowed disabled:opacity-40"
            title="Нэг буруу хариултыг арилгана (оноо хагасална)"
          >
            💡 Сэжүүр{hintUsedThisRound ? ' · ашигласан' : ''}
          </button>
          <button
            onClick={skip}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted transition hover:border-pink/60 hover:text-ink"
          >
            Алгасах →
          </button>
        </div>
      )}

      {/* Reveal banner */}
      {revealed && lastResult && (
        <div className="mt-8 flex flex-col items-center gap-4 animate-fade-up">
          <div
            className={`text-center text-xl font-extrabold ${
              lastResult.correct ? 'text-accent-green' : 'text-pink'
            }`}
          >
            {lastResult.correct
              ? `Зөв! +${lastResult.points.toLocaleString()} оноо`
              : OUTCOME_LABEL[lastResult.outcome]}
            {lastResult.correct && lastResult.hintUsed && (
              <div className="mt-1 text-sm font-normal text-amber">💡 Сэжүүр — оноо хагасласан</div>
            )}
            {!lastResult.correct && (
              <div className="mt-1 text-sm font-normal text-muted">
                Зөв хариулт: <span className="text-ink">{lastResult.answerTitle}</span>
              </div>
            )}
          </div>
          <Button onClick={next}>
            {roundIndex + 1 >= config.rounds ? 'Дүн харах →' : 'Дараагийн раунд →'}
          </Button>
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">{children}</div>
  )
}

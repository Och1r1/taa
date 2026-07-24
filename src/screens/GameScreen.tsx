import { useEffect } from 'react'
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

  useEffect(() => {
    if (!round) return
    const activeRound = round
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const optionIndex = Number(event.key) - 1
      if (phase === 'playing' && optionIndex >= 0 && optionIndex < activeRound.options.length) {
        const option = activeRound.options[optionIndex]
        if (option.songId !== eliminatedOptionId) answer(option.songId)
      }
      if (phase === 'playing' && event.key.toLowerCase() === 'h') hint()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [answer, eliminatedOptionId, hint, phase, round])

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

  const optionPrompt =
    round.answer.mediaType === 'image'
      ? 'Энэ хэн бэ?'
      : round.answer.mediaType === 'video'
        ? 'Аль клип вэ?'
        : 'Аль дуу вэ?'

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 lg:px-10">
      {/* Status bar */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <EqualizerBars className="h-5" />
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-2">Раунд</div>
            <div className="text-lg font-black leading-none">
              {roundIndex + 1}
              <span className="font-bold text-muted-2"> / {config.rounds}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => { reset(); onQuit() }}
          className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted transition hover:border-pink/60 hover:text-ink"
        >
          Гарах
        </button>
        <div className="text-right">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-2">Оноо</div>
          <div className="text-lg font-black leading-none text-cyan">{score.toLocaleString()}</div>
        </div>
      </div>

      {/* Timer */}
      <div className="mb-7">
        <TimerBar timeLeft={timeLeft} total={config.timePerRound} />
      </div>

      {/* Media (audio / video / image) */}
      <MediaStage item={round.answer} revealed={revealed} />

      {/* Options */}
      <div className="mb-4 text-xs font-extrabold uppercase tracking-[0.14em] text-muted-2">
        {optionPrompt}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
      {!revealed && (
        <div className="mt-3.5 text-center text-[11px] text-muted-2">
          1–4 товчоор хариулна · H товчоор сэжүүр
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

import type { GameEngine } from '../game/useGameEngine'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { OptionCard } from '../components/OptionCard'
import { TimerBar } from '../components/TimerBar'

interface Props {
  engine: GameEngine
  onQuit: () => void
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
    isAudioPlaying,
    answer,
    next,
    replaySnippet,
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

      {/* Now playing */}
      <div className="mb-8 flex flex-col items-center rounded-3xl border border-border bg-surface/70 py-10">
        <EqualizerBars active={isAudioPlaying && !revealed} className="mb-5 h-12" />
        <div className="text-sm font-semibold text-muted">Одоо тоглож байна…</div>
        <div className="mt-1 text-xs text-muted-2">Дуунаас хэсэг сонсоод нэрийг нь таа</div>
        {!revealed && (
          <button
            onClick={replaySnippet}
            className="mt-5 rounded-full border border-border px-4 py-2 text-sm text-ink-soft hover:border-cyan/60"
          >
            ↻ Дахин сонсох
          </button>
        )}
      </div>

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
            onPick={answer}
          />
        ))}
      </div>

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
              : lastResult.pickedTitle
                ? 'Буруу байна'
                : 'Хугацаа дууслаа'}
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

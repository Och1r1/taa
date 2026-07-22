import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { MediaStage } from '../components/MediaStage'
import { OptionCard } from '../components/OptionCard'
import { TimerBar } from '../components/TimerBar'
import { closeRoom, leaveRoom } from '../api/rooms'
import { useMultiGame } from '../game/useMultiGame'
import type { MultiSession, RoundOutcome, Song } from '../types'
import { useState } from 'react'

interface Props {
  session: MultiSession
  onLeave: () => void
}

const OUTCOME_LABEL: Record<RoundOutcome, string> = {
  correct: 'Зөв!',
  wrong: 'Буруу байна',
  timeout: 'Хугацаа дууслаа',
  skipped: 'Алгассан',
}

/** Synced multiplayer play + podium. Host auto-advances rounds. */
export function MultiGameScreen({ session, onLeave }: Props) {
  const game = useMultiGame(session)
  const [leaving, setLeaving] = useState(false)

  async function handleLeave() {
    setLeaving(true)
    try {
      if (session.isHost && session.hostToken) {
        await closeRoom(session.roomId, session.hostToken)
      } else {
        await leaveRoom(session.roomId, session.playerId)
      }
      onLeave()
    } catch {
      onLeave()
    }
  }

  if (game.loading) {
    return (
      <Centered>
        <EqualizerBars className="mb-4 h-10" />
        <p className="text-muted">Тоглоом ачааллаж байна…</p>
      </Centered>
    )
  }

  if (!game.room || game.room.status === 'closed') {
    return (
      <Centered>
        <p className="mb-4 font-bold text-amber">Өрөө хаагдсан.</p>
        <Button onClick={onLeave}>Нүүр рүү буцах</Button>
      </Centered>
    )
  }

  if (game.room.status === 'lobby') {
    // Parent MultiSessionGate switches to LobbyScreen on lobby status; this is
    // only a brief handoff while Realtime catches up after rematch.
    return (
      <Centered>
        <EqualizerBars className="mb-4 h-10" />
        <p className="text-muted">Лобби руу буцаж байна…</p>
      </Centered>
    )
  }

  if (game.room.status === 'finished') {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-2">Хамтдаа · дүн</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Тоглоом дууслаа</h1>
        <p className="mt-2 text-muted">
          {session.isHost
            ? 'Эцсийн онооны самбар. Дахин тоглох үед лобби руу буцана.'
            : 'Эцсийн онооны самбар. Хөтлөгч дахин эхлүүлэхийг хүлээнэ үү.'}
        </p>

        {game.error && (
          <p className="mt-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
            {game.error}
          </p>
        )}

        {!session.isHost && (
          <p className="mt-4 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm text-cyan">
            Хөтлөгч «Дахин тоглох» дармагц лобби руу буцна.
          </p>
        )}

        <ol className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {game.rankedPlayers.map((player, index) => {
            const isYou = player.id === session.playerId
            return (
              <li
                key={player.id}
                className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      index === 0
                        ? 'bg-amber/20 text-amber'
                        : index === 1
                          ? 'bg-cyan/20 text-cyan'
                          : index === 2
                            ? 'bg-pink/20 text-pink'
                            : 'bg-raised text-muted'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="truncate font-bold">
                    {player.nickname}
                    {isYou ? ' · та' : ''}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-extrabold text-cyan">{player.score.toLocaleString()}</div>
                  <div className="text-xs text-muted">{player.correctCount} зөв</div>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-8 flex flex-wrap gap-3">
          {session.isHost && (
            <Button disabled={game.starting} onClick={() => void game.restartGame()}>
              {game.starting ? 'Лобби руу буцаж байна…' : 'Дахин тоглох'}
            </Button>
          )}
          <Button variant="ghost" onClick={onLeave}>
            Нүүр рүү буцах
          </Button>
        </div>
      </div>
    )
  }

  const revealed = game.room.status === 'revealing' || game.round?.status === 'revealed'
  const isCountdown = game.room.status === 'countdown'
  const mediaItem: Song | null = game.round
    ? {
        id: game.round.answerSongId,
        artistId: '',
        title: game.round.answerTitle,
        mediaType: game.round.mediaType,
        mediaPath: game.round.mediaPath,
        mediaUrl: game.round.mediaUrl,
        snippetStart: game.round.snippetStart,
        snippetDuration: game.round.snippetDuration,
      }
    : null

  const you = game.players.find((p) => p.id === session.playerId)
  const answeredCount = game.round
    ? game.answers.filter((answer) => answer.roundIndex === game.round!.roundIndex).length
    : 0

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold tracking-widest text-muted-2">РАУНД</div>
          <div className="text-lg font-extrabold">
            {(game.room.currentRoundIndex ?? 0) + 1}
            <span className="text-muted"> / {game.room.rounds}</span>
          </div>
        </div>
        <button
          disabled={leaving}
          onClick={() => void handleLeave()}
          className="text-sm text-muted hover:text-ink"
        >
          Гарах
        </button>
        <div className="text-right">
          <div className="text-xs font-bold tracking-widest text-muted-2">ОНОО</div>
          <div className="text-lg font-extrabold text-cyan">
            {(you?.score ?? 0).toLocaleString()}
          </div>
        </div>
      </div>

      {game.error && (
        <p className="mb-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {game.error}
        </p>
      )}

      {isCountdown ? (
        <Centered>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-2">Дараагийн раунд</p>
          <p className="mt-3 text-6xl font-extrabold text-cyan">
            {Math.max(0, Math.ceil(game.countdownLeft))}
          </p>
          <p className="mt-3 text-muted">Бэлдээрэй!</p>
        </Centered>
      ) : !game.round || !mediaItem ? (
        <Centered>
          <EqualizerBars className="mb-4 h-10" />
          <p className="text-muted">Раунд бэлдэж байна…</p>
        </Centered>
      ) : (
        <>
          {!revealed && (
            <div className="mb-8">
              <TimerBar timeLeft={game.timeLeft} total={game.room.timePerRound} />
              <p className="mt-2 text-center text-xs text-muted">
                Хариулсан: {answeredCount}/{game.players.length}
              </p>
            </div>
          )}

          <MediaStage item={mediaItem} revealed={revealed} />

          <div className="grid gap-3 sm:grid-cols-2">
            {game.round.options.map((opt, i) => (
              <OptionCard
                key={opt.songId}
                option={opt}
                index={i}
                disabled={revealed || Boolean(game.myAnswer)}
                revealed={revealed}
                isAnswer={revealed && opt.songId === game.round!.answerSongId}
                isPicked={opt.songId === game.myAnswer?.pickedSongId}
                onPick={(id) => void game.answer(id)}
              />
            ))}
          </div>

          {game.answerError && (
            <p className="mt-4 text-center text-sm text-pink">{game.answerError}</p>
          )}

          {!revealed && game.myAnswer && (
            <p className="mt-6 text-center text-sm font-bold text-cyan">
              Хариулт илгээгдлээ — бусдыг хүлээж байна…
            </p>
          )}

          {revealed && (
            <div className="mt-8 animate-fade-up">
              {game.myAnswer && (
                <div
                  className={`mb-6 text-center text-xl font-extrabold ${
                    game.myAnswer.outcome === 'correct' ? 'text-accent-green' : 'text-pink'
                  }`}
                >
                  {game.myAnswer.outcome === 'correct'
                    ? `Зөв! +${game.myAnswer.points.toLocaleString()} оноо`
                    : OUTCOME_LABEL[game.myAnswer.outcome]}
                  {game.myAnswer.outcome !== 'correct' && (
                    <div className="mt-1 text-sm font-normal text-muted">
                      Зөв хариулт: <span className="text-ink">{game.round.answerTitle}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs font-bold uppercase tracking-widest text-muted-2">
                Онооны самбар
              </div>
              <ol className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {game.rankedPlayers.map((player, index) => (
                  <li
                    key={player.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="font-bold">
                      {index + 1}. {player.nickname}
                      {player.id === session.playerId ? ' · та' : ''}
                    </span>
                    <span className="font-extrabold text-cyan">
                      {player.score.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-center text-sm text-muted">
                {session.isHost
                  ? game.room.currentRoundIndex + 1 >= game.room.rounds
                    ? 'Дүн рүү шилжиж байна…'
                    : 'Дараагийн раунд удахгүй…'
                  : 'Хөтлөгч дараагийн алхам руу шилжүүлнэ…'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">{children}</div>
  )
}

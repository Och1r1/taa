import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { MediaStage } from '../components/MediaStage'
import { OptionCard } from '../components/OptionCard'
import { TimerBar } from '../components/TimerBar'
import { closeRoom, leaveRoom, respondRematch } from '../api/rooms'
import { useMultiGame, type MultiGameApi } from '../game/useMultiGame'
import type { MultiSession, RoundOutcome, Song } from '../types'
import { useEffect, useState } from 'react'

interface Props {
  session: MultiSession
  onLeave: () => void
  onSessionChange: (session: MultiSession) => void
}

const OUTCOME_LABEL: Record<RoundOutcome, string> = {
  correct: 'Зөв!',
  wrong: 'Буруу байна',
  timeout: 'Хугацаа дууслаа',
  skipped: 'Алгассан',
}

function rematchSecondsLeft(deadline: string | null): number {
  if (!deadline) return 0
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000))
}

/** Synced multiplayer play + podium. Host auto-advances rounds. */
export function MultiGameScreen({ session, onLeave, onSessionChange }: Props) {
  const game = useMultiGame(session)
  const [leaving, setLeaving] = useState(false)
  const [rematchBusy, setRematchBusy] = useState(false)
  const [rematchDeclined, setRematchDeclined] = useState(false)
  const [rematchError, setRematchError] = useState<string | null>(null)
  const [rematchLeft, setRematchLeft] = useState(0)
  const [presenterMode, setPresenterMode] = useState(false)

  useEffect(() => {
    if (game.room?.status !== 'finished' || game.room.rematchStatus !== 'pending') {
      setRematchLeft(0)
      return
    }
    const tick = () => setRematchLeft(rematchSecondsLeft(game.room?.rematchDeadline ?? null))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [game.room?.status, game.room?.rematchDeadline, game.room?.rematchStatus])

  async function handleLeave() {
    setLeaving(true)
    try {
      if (session.isHost) {
        await closeRoom(session.roomId)
      } else {
        await leaveRoom(session.roomId, session.playerId)
      }
      onLeave()
    } catch {
      onLeave()
    }
  }

  async function handleProposeRematch() {
    const next = await game.proposeRematch()
    if (next) onSessionChange(next)
  }

  async function handleRespondRematch(accept: boolean) {
    setRematchBusy(true)
    setRematchError(null)
    try {
      const result = await respondRematch(session.roomId, accept)
      if (!('session' in result)) {
        setRematchDeclined(true)
        return
      }
      onSessionChange(result.session)
    } catch (err) {
      setRematchError(err instanceof Error ? err.message : 'Хариу илгээж чадсангүй')
    } finally {
      setRematchBusy(false)
    }
  }

  function downloadStandings() {
    const header = 'rank,nickname,score,correct_count,team\n'
    const rows = game.rankedPlayers.map((player, index) =>
      `${index + 1},"${player.nickname.replace(/"/g, '""')}",${player.score},${player.correctCount},${player.team ?? ''}`,
    )
    const blob = new Blob([header + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `taa-standings-${game.room?.pin ?? 'room'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function togglePresenterMode() {
    setPresenterMode((open) => !open)
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.()
      else await document.exitFullscreen()
    } catch {
      /* fullscreen is optional */
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
    return (
      <Centered>
        <EqualizerBars className="mb-4 h-10" />
        <p className="text-muted">Лобби руу буцаж байна…</p>
      </Centered>
    )
  }

  if (game.room.status === 'finished') {
    const rematchPending = game.room.rematchStatus === 'pending' && Boolean(game.room.rematchRoomId)
    const rematchOpen = rematchPending && rematchLeft > 0 && !rematchDeclined
    const rematchTimedOut = rematchPending && rematchLeft <= 0

    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-2">Хамтдаа · дүн</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Тоглоом дууслаа</h1>
        <p className="mt-2 text-muted">
          {session.isHost
            ? 'Эцсийн онооны самбар. Дахин тоглох нь шинэ өрөө нээнэ — бусад тоглогчид зөвшөөрнө.'
            : 'Эцсийн онооны самбар. Хөтлөгч дахин тоглох санал илгээхийг хүлээнэ үү.'}
        </p>

        {(game.error || rematchError) && (
          <p className="mt-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
            {game.error ?? rematchError}
          </p>
        )}

        {!session.isHost && !rematchPending && (
          <p className="mt-4 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm text-cyan">
            Хөтлөгч «Дахин тоглох» дармагц шинэ өрөөний санал ирнэ.
          </p>
        )}

        {rematchOpen && !session.isHost && (
          <div className="mt-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-4">
            <p className="font-bold text-ink">Дахин тоглох санал ирлээ</p>
            <p className="mt-1 text-sm text-muted">
              Шинэ лобби руу нэгдэх үү? Үлдсэн хугацаа: {rematchLeft}с
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={rematchBusy} onClick={() => void handleRespondRematch(true)}>
                {rematchBusy ? '…' : 'Зөвшөөрөх'}
              </Button>
              <Button
                variant="ghost"
                disabled={rematchBusy}
                onClick={() => void handleRespondRematch(false)}
              >
                Татгалзах
              </Button>
            </div>
          </div>
        )}

        {(rematchDeclined || rematchTimedOut) && !session.isHost && (
          <p className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            {rematchDeclined
              ? 'Та дахин тоглохоос татгалзлаа.'
              : 'Дахин тоглох хугацаа дууссан.'}
          </p>
        )}

        {session.isHost && rematchPending && (
          <p className="mt-4 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm text-cyan">
            Шинэ өрөө нээгдсэн. Тоглогчид зөвшөөрөхийг хүлээж байна
            {rematchLeft > 0 ? ` (${rematchLeft}с)` : ''}.
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
            <Button variant="ghost" onClick={downloadStandings}>
              ↓ CSV дүн татах
            </Button>
          )}
          {session.isHost && !rematchPending && (
            <Button disabled={game.starting} onClick={() => void handleProposeRematch()}>
              {game.starting ? 'Шинэ өрөө нээж байна…' : 'Дахин тоглох'}
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
  const isSpectator = session.role === 'spectator' || you?.role === 'spectator'
  const answeringPlayers = game.players.filter((p) => !p.isHost && p.role !== 'spectator')
  const answeredCount = game.round
    ? game.answers.filter((answer) => answer.roundIndex === game.round!.roundIndex).length
    : 0
  const teamScores = teamStandings(game.players)

  if (presenterMode && session.isHost) {
    return (
      <PresenterGame
        game={game}
        mediaItem={mediaItem}
        revealed={revealed}
        onExit={() => void togglePresenterMode()}
      />
    )
  }

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
        {session.isHost && (
          <button
            type="button"
            onClick={() => void togglePresenterMode()}
            className="rounded-lg px-3 py-2 text-sm font-bold text-cyan hover:bg-cyan/10"
          >
            ⛶ Танилцуулах
          </button>
        )}
        <div className="text-right">
          <div className="text-xs font-bold tracking-widest text-muted-2">
            {isSpectator ? 'ҮЗЭГЧ' : 'ОНОО'}
          </div>
          <div className="text-lg font-extrabold text-cyan">
            {isSpectator ? '—' : (you?.score ?? 0).toLocaleString()}
          </div>
        </div>
      </div>

      {isSpectator && (
        <p className="mb-4 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm text-cyan">
          Та үзэгчээр нэгдсэн — хариулт өгөхгүй, зөвхөн үзнэ.
        </p>
      )}

      {game.error && (
        <p className="mb-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
          {game.error}
        </p>
      )}

      {game.reconnected && (
        <p className="mb-4 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm text-cyan">
          Өрөөний одоогийн төлөвтэй дахин холбогдлоо.
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
                Хариулсан: {answeredCount}/{answeringPlayers.length}
              </p>
            </div>
          )}

          {teamScores.length === 2 && (
            <TeamStandings scores={teamScores} />
          )}

          <MediaStage item={mediaItem} revealed={revealed} />

          <div className="grid gap-3 sm:grid-cols-2">
            {game.round.options.map((opt, i) => (
              <OptionCard
                key={opt.songId}
                option={opt}
                index={i}
                disabled={isSpectator || revealed || Boolean(game.myAnswer)}
                revealed={revealed}
                isAnswer={revealed && opt.songId === game.round!.answerSongId}
                isPicked={!isSpectator && opt.songId === game.myAnswer?.pickedSongId}
                onPick={(id) => {
                  if (isSpectator) return
                  void game.answer(id)
                }}
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

function PresenterGame({
  game,
  mediaItem,
  revealed,
  onExit,
}: {
  game: MultiGameApi
  mediaItem: Song | null
  revealed: boolean
  onExit: () => void
}) {
  const room = game.room
  if (!room) return null
  const isCountdown = room.status === 'countdown'
  const teamScores = teamStandings(game.players)
  return (
    <div className="min-h-screen bg-base px-8 py-10 text-center sm:px-16">
      <div className="mx-auto flex max-w-6xl items-center justify-between text-left">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-2">Таа · event mode</p>
          <p className="mt-1 text-xl font-black">Раунд {room.currentRoundIndex + 1} / {room.rounds}</p>
        </div>
        <button onClick={onExit} className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-muted hover:text-ink">
          Хөтлөгчийн самбар
        </button>
      </div>
      {isCountdown ? (
        <div className="flex min-h-[70vh] flex-col items-center justify-center">
          <p className="text-xl font-bold text-muted">Дараагийн раунд</p>
          <p className="mt-4 text-9xl font-black text-cyan">{Math.max(0, Math.ceil(game.countdownLeft))}</p>
        </div>
      ) : !mediaItem ? (
        <div className="flex min-h-[70vh] items-center justify-center text-xl text-muted">Раунд бэлдэж байна…</div>
      ) : (
        <div className="mx-auto mt-10 max-w-4xl">
          {!revealed && <TimerBar timeLeft={game.timeLeft} total={room.timePerRound} />}
          <div className="mt-8"><MediaStage item={mediaItem} revealed={revealed} /></div>
          {revealed ? (
            <div className="mt-8">
              <p className="text-3xl font-black text-accent-green">Зөв хариулт: {game.round?.answerTitle}</p>
              {teamScores.length === 2 && <TeamStandings scores={teamScores} large />}
              <ol className="mx-auto mt-8 max-w-2xl divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-left">
                {game.rankedPlayers.slice(0, 5).map((player, index) => (
                  <li key={player.id} className="flex justify-between px-5 py-4 text-xl font-bold">
                    <span>{index + 1}. {player.nickname}</span><span className="text-cyan">{player.score.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="mt-6 text-lg font-bold text-muted">Утсаараа хариултаа сонгоно уу</p>
          )}
        </div>
      )}
    </div>
  )
}

function teamStandings(players: { team: 1 | 2 | null; score: number; role: string }[]) {
  const scores = [1, 2].map((team) => ({
    team,
    points: players.filter((player) => player.team === team && player.role !== 'spectator').reduce((sum, player) => sum + player.score, 0),
    members: players.filter((player) => player.team === team && player.role !== 'spectator').length,
  })).filter((team) => team.members > 0)
  return scores.length === 2 ? scores : []
}

function TeamStandings({ scores, large = false }: { scores: ReturnType<typeof teamStandings>; large?: boolean }) {
  return <div className={`mt-5 grid grid-cols-2 gap-3 ${large ? 'mx-auto max-w-2xl' : ''}`}>
    {scores.map((entry) => <div key={entry.team} className={`rounded-2xl border p-4 text-center ${entry.team === 1 ? 'border-cyan/40 bg-cyan/10' : 'border-pink/40 bg-pink/10'}`}>
      <div className="text-xs font-bold uppercase tracking-widest text-muted-2">Баг {entry.team}</div>
      <div className={`${large ? 'text-4xl' : 'text-2xl'} mt-1 font-black ${entry.team === 1 ? 'text-cyan' : 'text-pink'}`}>{entry.points.toLocaleString()}</div>
      <div className="text-xs text-muted">{entry.members} тоглогч</div>
    </div>)}
  </div>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">{children}</div>
  )
}

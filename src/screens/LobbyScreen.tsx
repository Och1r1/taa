import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { beginRoomCountdown, closeRoom, kickRoomPlayer, leaveRoom } from '../api/rooms'
import { useRoomPresence } from '../game/useRoomPresence'
import { buildJoinUrl } from '../lib/joinUrl'
import type { GameRoom, MultiSession, RoomPlayer } from '../types'

interface Props {
  session: MultiSession
  room: GameRoom | null
  players: RoomPlayer[]
  loading: boolean
  error: string | null
  onLeave: () => void
}

const COUNTDOWN_SECONDS = 3

/** Lobby: PIN, live players, host starts synced game. */
export function LobbyScreen({
  session,
  room,
  players,
  loading,
  error,
  onLeave,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [kickingId, setKickingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'pin' | 'link' | null>(null)

  const closed = Boolean(!loading && (!room || room.status === 'closed'))
  const pin = room?.pin ?? session.pin
  const joinUrl = (() => {
    try {
      return buildJoinUrl(pin)
    } catch {
      return null
    }
  })()
  const presenceEnabled = Boolean(room && room.status === 'lobby' && !closed)
  const { onlineIds } = useRoomPresence(session, players, presenceEnabled)

  // Guest was removed (kick / idle prune) — leave the local session cleanly.
  useEffect(() => {
    if (loading || !room || room.status === 'closed') return
    if (players.length === 0) return
    if (players.some((player) => player.id === session.playerId)) return
    onLeave()
  }, [loading, onLeave, players, room, session.playerId])

  async function handleLeave() {
    setBusy(true)
    setActionError(null)
    try {
      if (session.isHost && session.hostToken) {
        await closeRoom(session.roomId, session.hostToken)
      } else {
        await leaveRoom(session.roomId, session.playerId)
      }
    } catch {
      /* still leave locally so the user is never stuck */
    }
    onLeave()
  }

  async function handleStart() {
    if (!session.isHost || !session.hostToken || !room) return
    setStarting(true)
    setActionError(null)
    try {
      await beginRoomCountdown(session.roomId, session.hostToken, COUNTDOWN_SECONDS)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Эхлүүлж чадсангүй')
      setStarting(false)
    }
  }

  async function handleKick(playerId: string) {
    if (!session.isHost || !session.hostToken) return
    setKickingId(playerId)
    setActionError(null)
    try {
      await kickRoomPlayer(session.roomId, session.hostToken, playerId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Тоглогчийг хасч чадсангүй')
    } finally {
      setKickingId(null)
    }
  }

  async function copyText(kind: 'pin' | 'link', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-10">
      <div className="mb-8 animate-fade-up">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-2">Хамтдаа · лобби</p>
        <h1 className="mt-2 text-3xl font-extrabold text-ink sm:text-4xl">
          {session.isHost ? 'Өрөө бэлэн' : 'Өрөөнд нэгдлээ'}
        </h1>
        <p className="mt-2 text-muted">
          {session.isHost
            ? 'Найзууддаа QR эсвэл холбоос илгээгээд бэлэн болмогц эхлүүлнэ үү. Дахин тоглох үед оноо шинэчлэгдэнэ.'
            : `Та ${session.nickname} нэрээр нэгдсэн. Хөтлөгч тоглоом эхлүүлэхийг хүлээнэ үү.`}
        </p>
      </div>

      {loading && !room ? (
        <div className="flex items-center gap-3 text-muted">
          <EqualizerBars className="h-5" /> Лобби ачааллаж байна…
        </div>
      ) : error && !room ? (
        <div className="rounded-xl border border-pink/40 bg-pink/10 px-4 py-3">
          <p className="text-sm text-pink">{error}</p>
          <Button className="mt-4" variant="ghost" onClick={onLeave}>
            Нүүр рүү буцах
          </Button>
        </div>
      ) : closed ? (
        <div className="rounded-2xl border border-amber/40 bg-amber/10 p-6">
          <p className="font-bold text-amber">Өрөө хаагдсан.</p>
          <p className="mt-1 text-sm text-muted">Хөтлөгч гарсан эсвэл өрөөний хугацаа дууссан.</p>
          <Button className="mt-4" onClick={onLeave}>
            Нүүр рүү буцах
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-surface p-6 text-center sm:p-8">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-2">Өрөөний код</div>
            <div className="mt-3 font-mono text-5xl font-extrabold tracking-[0.35em] text-ink sm:text-6xl">
              {pin}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void copyText('pin', pin)}
                className="text-sm font-bold text-cyan hover:underline"
              >
                {copied === 'pin' ? 'Хуулагдлаа ✓' : 'PIN хуулах'}
              </button>
              {joinUrl && (
                <button
                  type="button"
                  onClick={() => void copyText('link', joinUrl)}
                  className="text-sm font-bold text-cyan hover:underline"
                >
                  {copied === 'link' ? 'Холбоос хуулагдлаа ✓' : 'Холбоос хуулах'}
                </button>
              )}
            </div>
            {room && (
              <p className="mt-4 text-sm text-muted">
                {room.artistSlug} · {room.rounds} раунд · {room.timePerRound}с
              </p>
            )}
          </div>

          {session.isHost && joinUrl && (
            <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-start sm:gap-6 sm:p-8">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={joinUrl} size={160} marginSize={0} title="Өрөөнд нэгдэх QR" />
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-2">
                  QR-аар нэгдэх
                </div>
                <p className="mt-2 text-sm text-muted">
                  Утасны камераар уншуулаад нэрийгээ оруулаад орно.
                </p>
                <p className="mt-3 break-all font-mono text-xs text-muted-2">{joinUrl}</p>
                <button
                  type="button"
                  onClick={() => void copyText('link', joinUrl)}
                  className="mt-3 text-sm font-bold text-cyan hover:underline"
                >
                  {copied === 'link' ? 'Холбоос хуулагдлаа ✓' : 'Холбоос хуулах'}
                </button>
              </div>
            </div>
          )}

          <div className="mb-3 mt-10 text-xs font-bold uppercase tracking-widest text-muted-2">
            Тоглогчид ({players.length}/20)
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {players.map((player) => {
              const isYou = player.id === session.playerId
              const online = onlineIds.has(player.id)
              const initial = (player.nickname || '?').slice(0, 1).toLocaleUpperCase()
              const canKick =
                session.isHost && session.hostToken && !player.isHost && player.id !== session.playerId
              return (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="relative">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          player.isHost ? 'bg-pink/20 text-pink' : 'bg-raised text-ink-soft'
                        }`}
                      >
                        {initial}
                      </span>
                      <span
                        className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                          online ? 'bg-cyan' : 'bg-muted-2'
                        }`}
                        title={online ? 'Онлайн' : 'Офлайн'}
                      />
                    </span>
                    <span className="truncate font-bold text-ink">
                      {player.nickname}
                      {isYou ? ' · та' : ''}
                      {!online && !isYou ? (
                        <span className="ml-2 text-xs font-bold text-muted">офлайн</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {player.isHost && (
                      <span className="rounded-lg bg-raised px-2.5 py-1 text-xs font-bold text-muted">
                        Хөтлөгч
                      </span>
                    )}
                    {canKick && (
                      <button
                        type="button"
                        disabled={busy || starting || kickingId === player.id}
                        onClick={() => void handleKick(player.id)}
                        className="rounded-lg px-2.5 py-1 text-xs font-bold text-pink hover:bg-pink/10 disabled:opacity-50"
                      >
                        {kickingId === player.id ? 'Хасаж байна…' : 'Хасах'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
            {players.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">Тоглогч алга байна.</li>
            )}
          </ul>

          {session.isHost && room && (
            <div className="mt-8">
              <Button
                disabled={starting || players.length < 1}
                onClick={() => void handleStart()}
                className="w-full py-4 text-base sm:w-auto sm:px-12"
              >
                {starting ? 'Эхлүүлж байна…' : '▶ Тоглоом эхлүүлэх'}
              </Button>
              <p className="mt-2 text-sm text-muted">
                Найзууд QR эсвэл PIN-аар нэгдсэний дараа эхлүүлнэ үү. Офлайн суудлыг хасаж болно.
              </p>
            </div>
          )}

          {actionError && (
            <p className="mt-4 rounded-xl border border-pink/40 bg-pink/10 px-4 py-3 text-sm text-pink">
              {actionError}
            </p>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="ghost" disabled={busy || starting} onClick={() => void handleLeave()}>
              {session.isHost ? 'Өрөөг хаах' : 'Гарах'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

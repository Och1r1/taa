import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../components/Button'
import { EqualizerBars } from '../components/EqualizerBars'
import { closeRoom, leaveRoom, startRoomRound } from '../api/rooms'
import { fetchSongsByArtistSlug } from '../api/songs'
import { makeRoundPick } from '../game/roundPick'
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
      const pool = await fetchSongsByArtistSlug(room.artistSlug)
      if (pool.length < 4) throw new Error('Багцад дор хаяж 4 асуулт хэрэгтэй')
      const { song, options } = makeRoundPick(pool, [])
      await startRoomRound({
        roomId: session.roomId,
        hostToken: session.hostToken,
        roundIndex: 0,
        song,
        options,
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Эхлүүлж чадсангүй')
      setStarting(false)
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
            ? 'Найзууддаа QR эсвэл холбоос илгээгээд тэд нэгдэхийг хүлээнэ үү.'
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
              const initial = (player.nickname || '?').slice(0, 1).toLocaleUpperCase()
              return (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        player.isHost ? 'bg-pink/20 text-pink' : 'bg-raised text-ink-soft'
                      }`}
                    >
                      {initial}
                    </span>
                    <span className="truncate font-bold text-ink">
                      {player.nickname}
                      {isYou ? ' · та' : ''}
                    </span>
                  </div>
                  {player.isHost && (
                    <span className="shrink-0 rounded-lg bg-raised px-2.5 py-1 text-xs font-bold text-muted">
                      Хөтлөгч
                    </span>
                  )}
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
                disabled={starting}
                onClick={() => void handleStart()}
                className="w-full py-4 text-base sm:w-auto sm:px-12"
              >
                {starting ? 'Эхлүүлж байна…' : '▶ Тоглоом эхлүүлэх'}
              </Button>
              <p className="mt-2 text-sm text-muted">
                Найзууд QR эсвэл PIN-аар нэгдсэний дараа эхлүүлнэ үү.
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

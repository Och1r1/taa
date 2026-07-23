import { useCallback, useEffect, useRef, useState } from 'react'
import {
  beginRoomCountdown,
  fetchRoom,
  fetchRoomPlayers,
  fetchRoomRound,
  fetchRoundAnswers,
  finishRoomGame,
  revealRoomRound,
  proposeRematch,
  startRoomRound,
  submitRoomAnswer,
  toRound,
} from '../api/rooms'
import { fetchSongsByArtistSlug } from '../api/songs'
import { supabase } from '../lib/supabase'
import { makeRoundPick } from './roundPick'
import type {
  GameRoom,
  MultiSession,
  RoomAnswer,
  RoomPlayer,
  RoomRound,
  Song,
} from '../types'

const REVEAL_HOLD_MS = 4500
const COUNTDOWN_SECONDS = 3
const ROOM_SYNC_MS = 2500
const ANSWER_REFRESH_DEBOUNCE_MS = 120

export interface MultiGameState {
  room: GameRoom | null
  players: RoomPlayer[]
  round: RoomRound | null
  answers: RoomAnswer[]
  myAnswer: RoomAnswer | null
  pendingAnswerSongId: string | null
  timeLeft: number
  countdownLeft: number
  loading: boolean
  starting: boolean
  error: string | null
  answerError: string | null
  reconnected: boolean
}

export interface MultiGameApi extends MultiGameState {
  startGame: () => Promise<void>
  proposeRematch: () => Promise<MultiSession | null>
  answer: (songId: string) => Promise<void>
  endGame: () => Promise<void>
  rankedPlayers: RoomPlayer[]
}

function mapRoomRow(row: {
  id: string
  pin: string
  status: GameRoom['status']
  host_player_id: string | null
  artist_slug: string
  category: string
  rounds: number
  time_per_round: number
  max_points: number
  current_round_index: number
  created_at: string
  expires_at: string
  countdown_ends_at?: string | null
  visibility?: string | null
  rematch_room_id?: string | null
  rematch_deadline?: string | null
  rematch_status?: string | null
}): GameRoom {
  const rematchStatus =
    row.rematch_status === 'pending' ||
    row.rematch_status === 'completed' ||
    row.rematch_status === 'cancelled'
      ? row.rematch_status
      : null
  return {
    id: row.id,
    pin: row.pin,
    status: row.status,
    hostPlayerId: row.host_player_id,
    artistSlug: row.artist_slug,
    category: row.category as GameRoom['category'],
    rounds: row.rounds,
    timePerRound: row.time_per_round,
    maxPoints: row.max_points,
    currentRoundIndex: row.current_round_index,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    countdownEndsAt: row.countdown_ends_at ?? null,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    inviteSecret: null,
    rematchRoomId: row.rematch_room_id ?? null,
    rematchDeadline: row.rematch_deadline ?? null,
    rematchStatus,
  }
}

/** Shared multiplayer game: Realtime state + host-driven round progression. */
export function useMultiGame(session: MultiSession): MultiGameApi {
  const [room, setRoom] = useState<GameRoom | null>(null)
  const [players, setPlayers] = useState<RoomPlayer[]>([])
  const [round, setRound] = useState<RoomRound | null>(null)
  const [answers, setAnswers] = useState<RoomAnswer[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [countdownLeft, setCountdownLeft] = useState(0)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [pendingAnswerSongId, setPendingAnswerSongId] = useState<string | null>(null)
  const [reconnected, setReconnected] = useState(false)

  const poolRef = useRef<Song[]>([])
  const usedIdsRef = useRef<string[]>([])
  const revealingRef = useRef(false)
  const advancingRef = useRef(false)
  // A countdown can trigger many renders while its clock sits at zero. Keep the
  // deadline that has already published a round, rather than unlocking after a
  // short timeout, so one countdown can only ever publish one round.
  const publishedCountdownRef = useRef<string | null>(null)
  const roomRef = useRef<GameRoom | null>(null)
  const roundRef = useRef<RoomRound | null>(null)
  const answersRef = useRef<RoomAnswer[]>([])
  const roundRequestRef = useRef(0)
  const syncRequestRef = useRef(0)
  const roomEventVersionRef = useRef(0)
  const sawLobbyRef = useRef(false)
  const answerRefreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  roomRef.current = room
  roundRef.current = round
  answersRef.current = answers

  // Answers are round-scoped. Never let a previous round's answer disable or
  // colour controls in the newly published round.
  const myAnswer = round
    ? answers.find(
        (answer) =>
          answer.playerId === session.playerId && answer.roundIndex === round.roundIndex,
      ) ?? null
    : null

  useEffect(() => {
    setPendingAnswerSongId(null)
  }, [round?.roundIndex])

  const refreshPlayers = useCallback(async () => {
    const list = await fetchRoomPlayers(session.roomId)
    setPlayers(list)
    return list
  }, [session.roomId])

  const refreshRoundBundle = useCallback(
    async (roundIndex: number) => {
      const requestId = ++roundRequestRef.current
      setAnswers([])
      const [nextRound, nextAnswers] = await Promise.all([
        fetchRoomRound(session.roomId, roundIndex),
        fetchRoundAnswers(session.roomId, roundIndex),
      ])
      // Realtime updates can arrive out of order. Only the latest requested
      // round may update the UI.
      if (requestId !== roundRequestRef.current) return { nextRound, nextAnswers }
      setRound(nextRound)
      setAnswers(nextAnswers)
      return { nextRound, nextAnswers }
    },
    [session.roomId],
  )

  // Realtime emits one event per submitted answer. Coalesce bursts into one
  // authoritative read so a busy room does not issue N identical requests.
  const scheduleAnswerRefresh = useCallback(
    (roundIndex: number) => {
      if (answerRefreshTimerRef.current !== null) window.clearTimeout(answerRefreshTimerRef.current)
      answerRefreshTimerRef.current = window.setTimeout(() => {
        answerRefreshTimerRef.current = null
        void fetchRoundAnswers(session.roomId, roundIndex).then((nextAnswers) => {
          if (roomRef.current?.currentRoundIndex === roundIndex) {
            setAnswers((current) => {
              const pending = current.filter(
                (answer) => answer.playerId === session.playerId && !nextAnswers.some((next) => next.id === answer.id),
              )
              return [...nextAnswers, ...pending]
            })
          }
        }).catch(() => {
          // Keep the last confirmed answers until the next Realtime event or recovery sync.
        })
      }, ANSWER_REFRESH_DEBOUNCE_MS)
    },
    [session.playerId, session.roomId],
  )

  // Realtime is the fast path, but browsers can suspend its socket and timers
  // while a tab is in the background. Fetch the authoritative room state when
  // the tab returns (and periodically while it is visible) so a player never
  // needs to refresh to recover from missed events.
  const syncRoomState = useCallback(async () => {
    const requestId = ++syncRequestRef.current
    const eventVersion = roomEventVersionRef.current
    const nextRoom = await fetchRoom(session.roomId)
    const nextPlayers = await fetchRoomPlayers(session.roomId)
    // Do not let a poll that started before a Realtime event overwrite the
    // newer room status (especially revealing → countdown → playing).
    if (requestId !== syncRequestRef.current || eventVersion !== roomEventVersionRef.current) {
      return roomRef.current
    }

    setRoom(nextRoom)
    setPlayers(nextPlayers)

    if (nextRoom?.status === 'lobby' || nextRoom?.status === 'closed') {
      setRound(null)
      setAnswers([])
    } else if (nextRoom?.status === 'playing' || nextRoom?.status === 'revealing') {
      await refreshRoundBundle(nextRoom.currentRoundIndex)
    }

    return nextRoom
  }, [refreshRoundBundle, session.roomId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function boot() {
      try {
        const nextRoom = await syncRoomState()
        if (cancelled) return
        if (nextRoom?.status === 'lobby') sawLobbyRef.current = true
        if (nextRoom && nextRoom.status !== 'lobby' && nextRoom.status !== 'closed') {
          // Mid-game refresh (not a fresh start from lobby this mount).
          if (!sawLobbyRef.current) {
            setReconnected(true)
            window.setTimeout(() => setReconnected(false), 3500)
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Алдаа гарлаа')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void boot()

    const channel = supabase
      .channel(`room-game-${session.roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${session.roomId}` },
        (payload) => {
          roomEventVersionRef.current += 1
          if (payload.eventType === 'DELETE') {
            setRoom(null)
            return
          }
          const next = mapRoomRow(payload.new as Parameters<typeof mapRoomRow>[0])
          setRoom(next)
          if (next.status === 'lobby') {
            setRound(null)
            setAnswers([])
            poolRef.current = []
            usedIdsRef.current = []
            publishedCountdownRef.current = null
          }
          if (next.status === 'playing' || next.status === 'revealing') {
            void refreshRoundBundle(next.currentRoundIndex)
          }
          if (next.status === 'revealing' || next.status === 'finished') {
            void refreshPlayers()
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${session.roomId}`,
        },
        () => {
          void refreshPlayers().then((list) => {
            if (!list.some((p) => p.id === session.playerId)) {
              setError('Та өрөөнөөс хасагдсан.')
            }
          })
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_rounds',
          filter: `room_id=eq.${session.roomId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') return
          const nextRound = toRound(payload.new as Parameters<typeof toRound>[0])
          if (roundRef.current?.roundIndex !== nextRound.roundIndex) {
            setAnswers([])
            // Load the matching answers as one bundle; the room and round
            // change events are delivered independently and may arrive in
            // either order.
            void refreshRoundBundle(nextRound.roundIndex)
          }
          setRound(nextRound)
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_answers',
          filter: `room_id=eq.${session.roomId}`,
        },
        () => {
          const idx = roomRef.current?.currentRoundIndex
          if (idx == null) return
          scheduleAnswerRefresh(idx)
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      if (answerRefreshTimerRef.current !== null) {
        window.clearTimeout(answerRefreshTimerRef.current)
        answerRefreshTimerRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [
    session.roomId,
    session.playerId,
    refreshPlayers,
    refreshRoundBundle,
    scheduleAnswerRefresh,
    syncRoomState,
  ])

  useEffect(() => {
    let cancelled = false

    const syncAfterResume = () => {
      if (document.visibilityState !== 'visible') return
      void syncRoomState().catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Өрөөтэй дахин холбогдож чадсангүй')
      })
    }

    document.addEventListener('visibilitychange', syncAfterResume)
    const syncId = window.setInterval(syncAfterResume, ROOM_SYNC_MS)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', syncAfterResume)
      window.clearInterval(syncId)
    }
  }, [syncRoomState])

  useEffect(() => {
    if (!round || round.status !== 'active' || room?.status !== 'playing') {
      setTimeLeft(0)
      return
    }
    const tick = () => {
      setTimeLeft(Math.max(0, (new Date(round.endsAt).getTime() - Date.now()) / 1000))
    }
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [round, room?.status])

  useEffect(() => {
    if (!room || room.status !== 'countdown' || !room.countdownEndsAt) {
      setCountdownLeft(0)
      return
    }
    const tick = () => {
      setCountdownLeft(
        Math.max(0, (new Date(room.countdownEndsAt!).getTime() - Date.now()) / 1000),
      )
    }
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [room])

  const publishRound = useCallback(
    async (roundIndex: number) => {
      if (!session.isHost) return
      const pool = poolRef.current
      if (pool.length < 4) throw new Error('Багцад хангалттай асуулт алга')
      const { song, options } = makeRoundPick(pool, usedIdsRef.current)
      usedIdsRef.current = [...usedIdsRef.current, song.id]
      await startRoomRound({
        roomId: session.roomId,
        roundIndex,
        song,
        options,
      })
    },
    [session.isHost, session.roomId],
  )

  const startGame = useCallback(async () => {
    if (!session.isHost || !room) return
    setStarting(true)
    setError(null)
    try {
      const pool = await fetchSongsByArtistSlug(room.artistSlug)
      if (pool.length < 4) throw new Error('Багцад дор хаяж 4 асуулт хэрэгтэй')
      poolRef.current = pool
      usedIdsRef.current = []
      await beginRoomCountdown(session.roomId, COUNTDOWN_SECONDS)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Эхлүүлж чадсангүй')
    } finally {
      setStarting(false)
    }
  }, [session.isHost, session.roomId, room])

  const endGame = useCallback(async () => {
    if (!session.isHost) return
    try {
      await finishRoomGame(session.roomId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Дуусгаж чадсангүй')
    }
  }, [session.isHost, session.roomId])

  const proposeRematchAction = useCallback(async () => {
    if (!session.isHost || !room) return null
    setStarting(true)
    setError(null)
    try {
      const result = await proposeRematch(session.roomId)
      return result.session
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Дахин тоглох санал амжилтгүй')
      return null
    } finally {
      setStarting(false)
    }
  }, [room, session.isHost, session.roomId])

  const answer = useCallback(
    async (songId: string) => {
      const current = roundRef.current
      const currentRoom = roomRef.current
      if (!current || !currentRoom || current.status !== 'active') return
      if (currentRoom.status !== 'playing') return
      if (
        answersRef.current.some(
          (answer) =>
            answer.playerId === session.playerId && answer.roundIndex === current.roundIndex,
        )
      ) {
        return
      }
      if (pendingAnswerSongId) return
      setAnswerError(null)
      setPendingAnswerSongId(songId)
      try {
        const saved = await submitRoomAnswer(
          session.roomId,
          session.playerId,
          current.roundIndex,
          songId,
        )
        setAnswers((prev) => {
          if (roundRef.current?.roundIndex !== current.roundIndex) return prev
          if (prev.some((a) => a.id === saved.id)) return prev
          return [...prev, saved]
        })
      } catch (err) {
        setAnswerError(err instanceof Error ? err.message : 'Хариулж чадсангүй')
        setPendingAnswerSongId(null)
      }
    },
    [pendingAnswerSongId, session.playerId, session.roomId],
  )

  // Host: auto-reveal
  useEffect(() => {
    if (!session.isHost) return
    if (!room || room.status !== 'playing' || !round || round.status !== 'active') return

    // The host is the stage controller, not an answer pad. Counting the host
    // here can make a room advance based on stale/host answers.
    const timedOut = timeLeft <= 0 && Date.now() >= new Date(round.endsAt).getTime()
    // Keep each round open until its server deadline. Advancing immediately
    // after the final answer makes the visible counter look broken and gives
    // players no time to confirm their selection.
    if (!timedOut) return
    if (revealingRef.current) return
    revealingRef.current = true

    void revealRoomRound(session.roomId, round.roundIndex)
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        revealingRef.current = false
      })
  }, [
    session.isHost,
    session.roomId,
    room,
    round,
    timeLeft,
  ])

  // Host: reveal hold → countdown or finish
  useEffect(() => {
    if (!session.isHost) return
    if (!room || room.status !== 'revealing' || !round || round.status !== 'revealed') return
    if (advancingRef.current) return

    advancingRef.current = true
    const roomId = session.roomId
    const nextIndex = room.currentRoundIndex + 1
    const total = room.rounds

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (nextIndex >= total) await finishRoomGame(roomId)
          else await beginRoomCountdown(roomId, COUNTDOWN_SECONDS)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Дараагийн алхам амжилтгүй')
        } finally {
          advancingRef.current = false
        }
      })()
    }, REVEAL_HOLD_MS)

    return () => {
      window.clearTimeout(timer)
      advancingRef.current = false
    }
  }, [
    session.isHost,
    session.roomId,
    room?.status,
    room?.currentRoundIndex,
    room?.rounds,
    round?.status,
    round?.roundIndex,
  ])

  // Host: countdown finished → publish round
  useEffect(() => {
    if (!session.isHost) return
    if (!room || room.status !== 'countdown' || !room.countdownEndsAt) return
    if (countdownLeft > 0.05) return
    if (publishedCountdownRef.current === room.countdownEndsAt) return
    publishedCountdownRef.current = room.countdownEndsAt

    void (async () => {
      try {
        if (poolRef.current.length < 4) {
          poolRef.current = await fetchSongsByArtistSlug(room.artistSlug)
        }
        // The database validates the next index against the number of persisted
        // rounds. Fetch it immediately before publishing: Realtime and a resumed
        // tab may otherwise leave `round` or `usedIdsRef` one transition behind.
        const { data, error } = await supabase
          .from('room_rounds')
          .select('answer_song_id')
          .eq('room_id', session.roomId)
        if (error) throw error
        usedIdsRef.current = (data ?? []).map((row: { answer_song_id: string }) => row.answer_song_id)
        const publishIndex = usedIdsRef.current.length
        await publishRound(publishIndex)
      } catch (err) {
        // Keep this countdown retryable if the RPC failed before it changed the
        // room state. A successful publish changes status to `playing`.
        if (publishedCountdownRef.current === room.countdownEndsAt) {
          publishedCountdownRef.current = null
        }
        setError(err instanceof Error ? err.message : 'Раунд эхлүүлж чадсангүй')
      }
    })()
  }, [
    session.isHost,
    session.roomId,
    room,
    round,
    countdownLeft,
    publishRound,
  ])

  useEffect(() => {
    if (!session.isHost || !room) return
    if (room.status === 'lobby' || room.status === 'closed') return

    let cancelled = false
    void (async () => {
      try {
        if (poolRef.current.length < 4) {
          poolRef.current = await fetchSongsByArtistSlug(room.artistSlug)
        }
        const { data } = await supabase
          .from('room_rounds')
          .select('answer_song_id')
          .eq('room_id', session.roomId)
        if (cancelled || !data) return
        usedIdsRef.current = data.map((row: { answer_song_id: string }) => row.answer_song_id)
      } catch {
        /* ignore */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [session.isHost, session.roomId, room])

  const rankedPlayers = [...players]
    .filter((player) => player.role !== 'spectator')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount
      return a.joinedAt.localeCompare(b.joinedAt)
    })

  return {
    room,
    players,
    round,
    answers,
    myAnswer,
    pendingAnswerSongId,
    timeLeft,
    countdownLeft,
    loading,
    starting,
    error,
    answerError,
    reconnected,
    startGame,
    proposeRematch: proposeRematchAction,
    answer,
    endGame,
    rankedPlayers,
  }
}

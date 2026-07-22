import { useEffect, useState } from 'react'
import { fetchRoom, fetchRoomPlayers } from '../api/rooms'
import { supabase } from '../lib/supabase'
import type { GameRoom, RoomPlayer } from '../types'

interface LobbyState {
  room: GameRoom | null
  players: RoomPlayer[]
  loading: boolean
  error: string | null
}

/** Live lobby: initial fetch + Realtime updates for room status and player list. */
export function useRoomLobby(roomId: string | null): LobbyState {
  const [room, setRoom] = useState<GameRoom | null>(null)
  const [players, setPlayers] = useState<RoomPlayer[]>([])
  const [loading, setLoading] = useState(Boolean(roomId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!roomId) {
      setRoom(null)
      setPlayers([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([fetchRoom(roomId), fetchRoomPlayers(roomId)])
      .then(([nextRoom, nextPlayers]) => {
        if (cancelled) return
        setRoom(nextRoom)
        setPlayers(nextPlayers)
        if (!nextRoom) setError('Өрөө олдсонгүй.')
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const channel = supabase
      .channel(`room-lobby-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setRoom(null)
            return
          }
          const row = payload.new as {
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
          }
          const rematchStatus =
            row.rematch_status === 'pending' ||
            row.rematch_status === 'completed' ||
            row.rematch_status === 'cancelled'
              ? row.rematch_status
              : null
          setRoom({
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
          })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
        () => {
          void fetchRoomPlayers(roomId)
            .then((list) => {
              if (!cancelled) setPlayers(list)
            })
            .catch(() => {
              /* keep last known list */
            })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [roomId])

  return { room, players, loading, error }
}

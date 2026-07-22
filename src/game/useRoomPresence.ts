import { useEffect, useState } from 'react'
import {
  heartbeatRoomPlayer,
  isPlayerOnline,
  pruneIdleRoomPlayers,
} from '../api/rooms'
import type { MultiSession, RoomPlayer } from '../types'

const HEARTBEAT_MS = 12_000
const PRUNE_MS = 30_000
const IDLE_SECONDS = 90

/**
 * Keeps last_seen fresh for this player and (host-only) prunes idle guests.
 * Returns a Set of currently-online player ids for UI dots.
 */
export function useRoomPresence(
  session: MultiSession,
  players: RoomPlayer[],
  enabled = true,
): { onlineIds: Set<string>; now: number } {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function beat() {
      try {
        await heartbeatRoomPlayer(session.roomId, session.playerId)
      } catch {
        /* player may have been kicked — UI will notice via Realtime */
      }
    }

    void beat()
    const heartId = window.setInterval(() => {
      if (!cancelled) void beat()
    }, HEARTBEAT_MS)

    const clockId = window.setInterval(() => {
      if (!cancelled) setNow(Date.now())
    }, 5_000)

    let pruneId: number | undefined
    if (session.isHost) {
      pruneId = window.setInterval(() => {
        void pruneIdleRoomPlayers(session.roomId, IDLE_SECONDS).catch(() => {
          /* ignore */
        })
      }, PRUNE_MS)
    }

    return () => {
      cancelled = true
      window.clearInterval(heartId)
      window.clearInterval(clockId)
      if (pruneId) window.clearInterval(pruneId)
    }
  }, [enabled, session.roomId, session.playerId, session.isHost])

  // If we were kicked, last_seen won't matter — parent clears session.
  const onlineIds = new Set(
    players.filter((p) => isPlayerOnline(p.lastSeen)).map((p) => p.id),
  )
  // Always treat self as online while this hook is mounted.
  onlineIds.add(session.playerId)

  return { onlineIds, now }
}

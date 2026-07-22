import { useEffect, useState } from 'react'
import { clearMultiSession, fetchRoom, loadMultiSession } from './api/rooms'
import { useGameEngine } from './game/useGameEngine'
import { useRoomLobby } from './game/useRoomLobby'
import { HomeScreen } from './screens/HomeScreen'
import { GameScreen } from './screens/GameScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import { LeaderboardScreen } from './screens/LeaderboardScreen'
import { LobbyScreen } from './screens/LobbyScreen'
import { MultiGameScreen } from './screens/MultiGameScreen'
import { Header, type NavView } from './components/Header'
import { Button } from './components/Button'
import { readJoinParamsFromUrl } from './lib/joinUrl'
import type { MultiSession } from './types'

function initialNavView(): NavView {
  const join = readJoinParamsFromUrl()
  // Join deep links always open home (Хамтдаа), even if ?category= is also present.
  if (join.pin || join.invite || /^\/join(\/|$)/i.test(window.location.pathname)) return 'home'
  return new URLSearchParams(window.location.search).has('category') ? 'leaderboard' : 'home'
}

export default function App() {
  const engine = useGameEngine()
  const [view, setView] = useState<NavView>(initialNavView)
  const [multiSession, setMultiSession] = useState<MultiSession | null>(null)
  const [restoringLobby, setRestoringLobby] = useState(true)

  useEffect(() => {
    const saved = loadMultiSession()
    if (!saved?.roomId || !saved.playerId) {
      clearMultiSession()
      setRestoringLobby(false)
      return
    }
    let cancelled = false
    fetchRoom(saved.roomId)
      .then((room) => {
        if (cancelled) return
        if (room && room.status !== 'closed') setMultiSession(saved)
        else clearMultiSession()
      })
      .catch(() => {
        if (!cancelled) clearMultiSession()
      })
      .finally(() => {
        if (!cancelled) setRestoringLobby(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function leaveMulti() {
    clearMultiSession()
    setMultiSession(null)
    setView('home')
  }

  function navigate(next: NavView) {
    // Leaving multi via nav should never trap the user on a blank lobby.
    if (multiSession) leaveMulti()
    setView(next)
    const url = new URL(window.location.href)
    if (next === 'home') url.searchParams.delete('category')
    window.history.pushState({}, '', url)
  }

  if (engine.phase === 'gameover') {
    const lastSlug = engine.artistSlug
    const lastCategory = engine.category
    const lastConfig = engine.config
    return (
      <ResultsScreen
        score={engine.score}
        results={engine.results}
        artistSlug={lastSlug}
        category={lastCategory}
        onPlayAgain={() => {
          engine.reset()
          if (lastSlug && lastCategory) void engine.start(lastSlug, lastCategory, lastConfig)
        }}
        onHome={engine.reset}
      />
    )
  }

  if (engine.phase === 'idle') {
    if (restoringLobby) {
      return (
        <div className="flex min-h-full items-center justify-center px-6 text-muted">
          Ачааллаж байна…
        </div>
      )
    }

    if (multiSession) {
      return (
        <div>
          <Header active="home" onNavigate={navigate} />
          <MultiSessionGate session={multiSession} onLeave={leaveMulti} />
        </div>
      )
    }

    return (
      <div>
        <Header active={view} onNavigate={navigate} />
        {view === 'leaderboard' ? (
          <LeaderboardScreen />
        ) : (
          <HomeScreen
            onStart={(slug, category, config) => void engine.start(slug, category, config)}
            onEnterLobby={(session) => setMultiSession(session)}
          />
        )}
      </div>
    )
  }

  return <GameScreen engine={engine} onQuit={engine.reset} />
}

/** Routes lobby ↔ live multiplayer game from room.status (single lobby subscription). */
function MultiSessionGate({
  session,
  onLeave,
}: {
  session: MultiSession
  onLeave: () => void
}) {
  const { room, players, loading, error } = useRoomLobby(session.roomId)

  const inGame =
    room != null &&
    (room.status === 'countdown' ||
      room.status === 'playing' ||
      room.status === 'revealing' ||
      room.status === 'finished')

  if (inGame) {
    return <MultiGameScreen session={session} onLeave={onLeave} />
  }

  // Always render lobby chrome — never a blank gate while loading/error.
  if (!session.roomId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-pink">Өрөөний мэдээлэл буруу байна.</p>
        <Button className="mt-4" onClick={onLeave}>
          Нүүр рүү буцах
        </Button>
      </div>
    )
  }

  return (
    <LobbyScreen
      session={session}
      room={room}
      players={players}
      loading={loading}
      error={error}
      onLeave={onLeave}
    />
  )
}

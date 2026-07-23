import { lazy, Suspense, useEffect, useState } from 'react'
import { clearMultiSession, fetchRoom, loadMultiSession } from './api/rooms'
import { useGameEngine } from './game/useGameEngine'
import { useRoomLobby } from './game/useRoomLobby'
import { GameScreen } from './screens/GameScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import { Header, type NavView } from './components/Header'
import { Button } from './components/Button'
import { readJoinParamsFromUrl } from './lib/joinUrl'
import { flushAnalyticsEvents } from './api/analytics'
import { isSupabaseConfigured } from './lib/supabase'
import type { MultiSession } from './types'

const HomeScreen = lazy(() => import('./screens/HomeScreen').then((m) => ({ default: m.HomeScreen })))
const LeaderboardScreen = lazy(() => import('./screens/LeaderboardScreen').then((m) => ({ default: m.LeaderboardScreen })))
const AccountScreen = lazy(() => import('./screens/AccountScreen').then((m) => ({ default: m.AccountScreen })))
const LobbyScreen = lazy(() => import('./screens/LobbyScreen').then((m) => ({ default: m.LobbyScreen })))
const MultiGameScreen = lazy(() => import('./screens/MultiGameScreen').then((m) => ({ default: m.MultiGameScreen })))

function initialNavView(): NavView {
  const join = readJoinParamsFromUrl()
  // Join deep links always open home (Хамтдаа), even if ?category= is also present.
  if (join.pin || join.invite || /^\/join(\/|$)/i.test(window.location.pathname)) return 'home'
  const params = new URLSearchParams(window.location.search)
  if (params.get('daily') === '1') return 'home'
  return params.has('category') ? 'leaderboard' : 'home'
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

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const flush = () => void flushAnalyticsEvents().catch(() => {
      // The optional analytics migration may not be deployed yet; retain events locally.
    })
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
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
    const lastGameKind = engine.gameKind
    return (
      <ResultsScreen
        score={engine.score}
        results={engine.results}
        artistSlug={lastSlug}
        category={lastCategory}
        gameKind={engine.gameKind}
        dailyKey={engine.dailyKey}
        onPlayAgain={() => {
          engine.reset()
          if (lastSlug && lastCategory) {
            if (lastGameKind === 'daily') void engine.startDaily(lastSlug, lastCategory, lastConfig)
            else void engine.start(lastSlug, lastCategory, lastConfig)
          }
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
          <Suspense fallback={<Loading />}><MultiSessionGate
            session={multiSession}
            onLeave={leaveMulti}
            onSessionChange={(next) => {
              setMultiSession(next)
            }}
          /></Suspense>
        </div>
      )
    }

    return (
      <div>
        <Header active={view} onNavigate={navigate} />
        <Suspense fallback={<Loading />}>{view === 'leaderboard' ? (
          <LeaderboardScreen />
        ) : view === 'account' ? (
          <AccountScreen />
        ) : (
          <HomeScreen
            onStart={(slug, category, config) => void engine.start(slug, category, config)}
            onStartDaily={(slug, category, config) => void engine.startDaily(slug, category, config)}
            onEnterLobby={(session) => setMultiSession(session)}
            onOpenAccount={() => navigate('account')}
          />
        )}</Suspense>
      </div>
    )
  }

  return <GameScreen engine={engine} onQuit={engine.reset} />
}

function Loading() { return <div className="flex min-h-[50vh] items-center justify-center text-muted">Ачааллаж байна…</div> }

/** Routes lobby ↔ live multiplayer game from room.status (single lobby subscription). */
function MultiSessionGate({
  session,
  onLeave,
  onSessionChange,
}: {
  session: MultiSession
  onLeave: () => void
  onSessionChange: (session: MultiSession) => void
}) {
  const { room, players, loading, error } = useRoomLobby(session.roomId)

  const inGame =
    room != null &&
    (room.status === 'countdown' ||
      room.status === 'playing' ||
      room.status === 'revealing' ||
      room.status === 'finished')

  if (inGame) {
    return (
      <MultiGameScreen
        key={session.roomId}
        session={session}
        onLeave={onLeave}
        onSessionChange={onSessionChange}
      />
    )
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
      key={session.roomId}
      session={session}
      room={room}
      players={players}
      loading={loading}
      error={error}
      onLeave={onLeave}
    />
  )
}

import { useState } from 'react'
import { useGameEngine } from './game/useGameEngine'
import { HomeScreen } from './screens/HomeScreen'
import { GameScreen } from './screens/GameScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import { LeaderboardScreen } from './screens/LeaderboardScreen'
import { Header, type NavView } from './components/Header'

export default function App() {
  const engine = useGameEngine()
  const [view, setView] = useState<NavView>('home')

  if (engine.phase === 'gameover') {
    const lastSlug = engine.artistSlug
    const lastConfig = engine.config
    return (
      <ResultsScreen
        score={engine.score}
        results={engine.results}
        artistSlug={lastSlug}
        onPlayAgain={() => {
          engine.reset()
          if (lastSlug) void engine.start(lastSlug, lastConfig)
        }}
        onHome={engine.reset}
      />
    )
  }

  if (engine.phase === 'idle') {
    return (
      <div>
        <Header active={view} onNavigate={setView} />
        {view === 'leaderboard' ? (
          <LeaderboardScreen />
        ) : (
          <HomeScreen onStart={(slug, config) => void engine.start(slug, config)} />
        )}
      </div>
    )
  }

  // loading | playing | revealed | error
  return <GameScreen engine={engine} onQuit={engine.reset} />
}

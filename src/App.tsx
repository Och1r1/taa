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
    return (
      <div>
        <Header active={view} onNavigate={setView} />
        {view === 'leaderboard' ? (
          <LeaderboardScreen />
        ) : (
          <HomeScreen onStart={(slug, category, config) => void engine.start(slug, category, config)} />
        )}
      </div>
    )
  }

  // loading | playing | revealed | error
  return <GameScreen engine={engine} onQuit={engine.reset} />
}

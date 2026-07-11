import { useGameEngine } from './game/useGameEngine'
import { HomeScreen } from './screens/HomeScreen'
import { GameScreen } from './screens/GameScreen'
import { ResultsScreen } from './screens/ResultsScreen'

export default function App() {
  const engine = useGameEngine()

  if (engine.phase === 'gameover') {
    return (
      <ResultsScreen
        score={engine.score}
        results={engine.results}
        onPlayAgain={() => {
          engine.reset()
          void engine.start()
        }}
        onHome={engine.reset}
      />
    )
  }

  if (engine.phase === 'idle') {
    return <HomeScreen onStart={() => void engine.start()} />
  }

  // loading | playing | revealed | error
  return <GameScreen engine={engine} onQuit={engine.reset} />
}

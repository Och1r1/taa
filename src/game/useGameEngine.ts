import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { GameConfig, GamePhase, Round, RoundOutcome, RoundResult, Song } from '../types'
import { fetchSongsByArtistSlug } from '../api/songs'
import { buildOptions, pickRandom, shuffle } from './shuffle'
import { computePoints } from './scoring'
import { useAudioSnippet } from '../audio/useAudioSnippet'

export const DEFAULT_CONFIG: GameConfig = {
  rounds: 5,
  timePerRound: 15,
  maxPoints: 1000,
}

const TICK_MS = 100
const TICK_SECONDS = TICK_MS / 1000

interface EngineState {
  phase: GamePhase
  config: GameConfig
  artistSlug: string | null
  pool: Song[]
  usedIds: string[]
  round: Round | null
  roundIndex: number
  timeLeft: number
  score: number
  results: RoundResult[]
  lastResult: RoundResult | null
  pickedSongId: string | null
  hintUsedThisRound: boolean
  eliminatedOptionId: string | null
  error: string | null
}

type Action =
  | { type: 'LOADING'; slug: string; config: GameConfig }
  | { type: 'LOADED'; pool: Song[] }
  | { type: 'TICK' }
  | { type: 'ANSWER'; songId: string | null }
  | { type: 'SKIP' }
  | { type: 'HINT' }
  | { type: 'NEXT' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' }

function initialState(config: GameConfig): EngineState {
  return {
    phase: 'idle',
    config,
    artistSlug: null,
    pool: [],
    usedIds: [],
    round: null,
    roundIndex: 0,
    timeLeft: config.timePerRound,
    score: 0,
    results: [],
    lastResult: null,
    pickedSongId: null,
    hintUsedThisRound: false,
    eliminatedOptionId: null,
    error: null,
  }
}

/** Pick a fresh answer + build a round, avoiding already-used songs when possible. */
function makeRound(pool: Song[], usedIds: string[]): { round: Round; answer: Song } {
  const available = pool.filter((s) => !usedIds.includes(s.id))
  const candidates = available.length > 0 ? available : pool
  const answer = pickRandom(candidates)
  return { round: { answer, options: buildOptions(answer, pool) }, answer }
}

function reveal(
  state: EngineState,
  songId: string | null,
  forcedOutcome?: RoundOutcome,
): EngineState {
  const { round, config } = state
  if (!round) return state
  const correct = songId === round.answer.id
  const outcome: RoundOutcome = forcedOutcome ?? (correct ? 'correct' : 'wrong')
  const hintUsed = state.hintUsedThisRound
  const timeLeft = Math.max(0, state.timeLeft)
  const points = computePoints(correct, timeLeft, config.timePerRound, config.maxPoints, hintUsed)
  const pickedTitle = songId
    ? round.options.find((o) => o.songId === songId)?.title ?? null
    : null

  const result: RoundResult = {
    roundIndex: state.roundIndex,
    answerTitle: round.answer.title,
    pickedTitle,
    correct,
    outcome,
    hintUsed,
    timeLeft,
    points,
  }

  return {
    ...state,
    phase: 'revealed',
    timeLeft,
    score: state.score + points,
    results: [...state.results, result],
    lastResult: result,
    pickedSongId: songId,
  }
}

function reducer(state: EngineState, action: Action): EngineState {
  switch (action.type) {
    case 'LOADING':
      return { ...initialState(action.config), phase: 'loading', artistSlug: action.slug }

    case 'LOADED': {
      const { round, answer } = makeRound(action.pool, [])
      return {
        ...initialState(state.config),
        phase: 'playing',
        artistSlug: state.artistSlug,
        pool: action.pool,
        usedIds: [answer.id],
        round,
        roundIndex: 0,
        timeLeft: state.config.timePerRound,
      }
    }

    case 'TICK': {
      if (state.phase !== 'playing') return state
      const next = state.timeLeft - TICK_SECONDS
      if (next <= 0) return reveal({ ...state, timeLeft: 0 }, null, 'timeout')
      return { ...state, timeLeft: next }
    }

    case 'ANSWER':
      if (state.phase !== 'playing') return state
      return reveal(state, action.songId)

    case 'SKIP':
      if (state.phase !== 'playing') return state
      return reveal(state, null, 'skipped')

    case 'HINT': {
      if (state.phase !== 'playing' || !state.round || state.hintUsedThisRound) return state
      // Eliminate one random wrong option.
      const wrong = state.round.options.filter((o) => o.songId !== state.round!.answer.id)
      if (wrong.length === 0) return state
      const eliminated = shuffle(wrong)[0]
      return { ...state, hintUsedThisRound: true, eliminatedOptionId: eliminated.songId }
    }

    case 'NEXT': {
      if (state.phase !== 'revealed') return state
      const isLast = state.roundIndex + 1 >= state.config.rounds
      if (isLast) return { ...state, phase: 'gameover' }
      const { round, answer } = makeRound(state.pool, state.usedIds)
      return {
        ...state,
        phase: 'playing',
        round,
        roundIndex: state.roundIndex + 1,
        usedIds: [...state.usedIds, answer.id],
        timeLeft: state.config.timePerRound,
        lastResult: null,
        pickedSongId: null,
        hintUsedThisRound: false,
        eliminatedOptionId: null,
      }
    }

    case 'ERROR':
      return { ...state, phase: 'error', error: action.message }

    case 'RESET':
      return initialState(state.config)

    default:
      return state
  }
}

export function useGameEngine(config: GameConfig = DEFAULT_CONFIG) {
  const [state, dispatch] = useReducer(reducer, config, initialState)
  const { play, stop, isPlaying } = useAudioSnippet()

  // Ticking timer — runs only while a round is in progress.
  useEffect(() => {
    if (state.phase !== 'playing') return
    const id = setInterval(() => dispatch({ type: 'TICK' }), TICK_MS)
    return () => clearInterval(id)
  }, [state.phase])

  // Play the snippet whenever a new round starts.
  const roundAnswerId = state.round?.answer.id
  useEffect(() => {
    if (state.phase !== 'playing' || !state.round) return
    const { answer } = state.round
    void play({ url: answer.audioUrl, start: answer.snippetStart, duration: answer.snippetDuration })
    // Stop audio when leaving the round.
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundAnswerId, state.phase])

  const startRef = useRef(false)
  const start = useCallback(async (slug: string, config: GameConfig = DEFAULT_CONFIG) => {
    if (startRef.current) return
    startRef.current = true
    dispatch({ type: 'LOADING', slug, config })
    try {
      const pool = await fetchSongsByArtistSlug(slug)
      if (pool.length < 4) {
        throw new Error(
          `Дор хаяж 4 дуу шаардлагатай (одоо ${pool.length}). Уран бүтээлчид дуу нэмнэ үү.`,
        )
      }
      dispatch({ type: 'LOADED', pool })
    } catch (err) {
      dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) })
    } finally {
      startRef.current = false
    }
  }, [])

  const answer = useCallback((songId: string) => {
    stop()
    dispatch({ type: 'ANSWER', songId })
  }, [stop])

  const skip = useCallback(() => {
    stop()
    dispatch({ type: 'SKIP' })
  }, [stop])

  const hint = useCallback(() => dispatch({ type: 'HINT' }), [])

  const next = useCallback(() => dispatch({ type: 'NEXT' }), [])
  const reset = useCallback(() => {
    stop()
    dispatch({ type: 'RESET' })
  }, [stop])

  const replaySnippet = useCallback(() => {
    if (state.phase === 'playing' && state.round) {
      const { answer: a } = state.round
      void play({ url: a.audioUrl, start: a.snippetStart, duration: a.snippetDuration })
    }
  }, [play, state.phase, state.round])

  return {
    ...state,
    isAudioPlaying: isPlaying,
    start,
    answer,
    skip,
    hint,
    next,
    reset,
    replaySnippet,
  }
}

export type GameEngine = ReturnType<typeof useGameEngine>

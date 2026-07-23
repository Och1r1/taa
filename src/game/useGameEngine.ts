import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Category, GameConfig, GamePhase, Round, RoundOutcome, RoundResult, Song } from '../types'
import { fetchSongsByArtistSlug } from '../api/songs'
import { buildOptions, pickRandom, shuffle } from './shuffle'
import { computePoints } from './scoring'
import { dailySeed, seededRandom } from './daily'
import { trackEvent } from '../lib/analytics'

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
  category: Category | null
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
  gameKind: 'solo' | 'daily'
  dailyKey: string | null
  randomSeed: string | null
}

type Action =
  | {
      type: 'LOADING'
      slug: string
      category: Category
      config: GameConfig
      gameKind: 'solo' | 'daily'
      dailyKey: string | null
      randomSeed: string | null
    }
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
    category: null,
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
    gameKind: 'solo',
    dailyKey: null,
    randomSeed: null,
  }
}

/** Pick a fresh answer + build a round, avoiding already-used songs when possible. */
function makeRound(
  pool: Song[],
  usedIds: string[],
  random: () => number = Math.random,
): { round: Round; answer: Song } {
  const available = pool.filter((s) => !usedIds.includes(s.id))
  const candidates = available.length > 0 ? available : pool
  const answer = pickRandom(candidates, random)
  return { round: { answer, options: buildOptions(answer, pool, random) }, answer }
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
      return {
        ...initialState(action.config),
        phase: 'loading',
        artistSlug: action.slug,
        category: action.category,
        gameKind: action.gameKind,
        dailyKey: action.dailyKey,
        randomSeed: action.randomSeed,
      }

    case 'LOADED': {
      const random = state.randomSeed ? seededRandom(state.randomSeed) : Math.random
      const { round, answer } = makeRound(action.pool, [], random)
      return {
        ...initialState(state.config),
        phase: 'playing',
        artistSlug: state.artistSlug,
        category: state.category,
        gameKind: state.gameKind,
        dailyKey: state.dailyKey,
        randomSeed: state.randomSeed,
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
      const random = state.randomSeed
        ? seededRandom(`${state.randomSeed}:${state.roundIndex + 1}`)
        : Math.random
      const { round, answer } = makeRound(state.pool, state.usedIds, random)
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

  // Ticking timer — runs only while a round is in progress. Media playback is
  // owned by <MediaStage>, so the engine stays media-agnostic.
  useEffect(() => {
    if (state.phase !== 'playing') return
    const id = setInterval(() => dispatch({ type: 'TICK' }), TICK_MS)
    return () => clearInterval(id)
  }, [state.phase])

  const startRef = useRef(false)
  const start = useCallback(async (
    slug: string,
    category: Category,
    config: GameConfig = DEFAULT_CONFIG,
    mode: { kind?: 'solo' | 'daily'; dateKey?: string } = {},
  ) => {
    if (startRef.current) return
    startRef.current = true
    const gameKind = mode.kind ?? 'solo'
    const key = gameKind === 'daily' ? mode.dateKey ?? new Date().toISOString().slice(0, 10) : null
    dispatch({
      type: 'LOADING',
      slug,
      category,
      config,
      gameKind,
      dailyKey: key,
      randomSeed: key ? dailySeed(key, slug) : null,
    })
    try {
      const pool = await fetchSongsByArtistSlug(slug)
      if (pool.length < 4) {
        throw new Error(
          `Дор хаяж 4 дуу шаардлагатай (одоо ${pool.length}). Уран бүтээлчид дуу нэмнэ үү.`,
        )
      }
      dispatch({ type: 'LOADED', pool })
      trackEvent(gameKind === 'daily' ? 'daily_started' : 'game_started', {
        artist: slug,
        category,
        rounds: config.rounds,
      })
    } catch (err) {
      dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) })
    } finally {
      startRef.current = false
    }
  }, [])

  const startDaily = useCallback(
    (slug: string, category: Category, config: GameConfig = DEFAULT_CONFIG) =>
      start(slug, category, { ...config, rounds: 5 }, { kind: 'daily' }),
    [start],
  )

  const answer = useCallback((songId: string) => dispatch({ type: 'ANSWER', songId }), [])
  const skip = useCallback(() => dispatch({ type: 'SKIP' }), [])
  const hint = useCallback(() => dispatch({ type: 'HINT' }), [])
  const next = useCallback(() => dispatch({ type: 'NEXT' }), [])
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  return {
    ...state,
    start,
    startDaily,
    answer,
    skip,
    hint,
    next,
    reset,
  }
}

export type GameEngine = ReturnType<typeof useGameEngine>

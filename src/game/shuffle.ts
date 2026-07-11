import type { AnswerOption, Song } from '../types'

/** Fisher–Yates shuffle. Returns a new array; does not mutate the input. */
export function shuffle<T>(input: readonly T[]): T[] {
  const arr = input.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function pickRandom<T>(input: readonly T[]): T {
  return input[Math.floor(Math.random() * input.length)]
}

/**
 * Build 4 answer options for a round: the correct song plus up to 3 distractor
 * titles drawn from the rest of the pool, all shuffled.
 */
export function buildOptions(answer: Song, pool: readonly Song[]): AnswerOption[] {
  const distractors = shuffle(pool.filter((s) => s.id !== answer.id)).slice(0, 3)
  const options: AnswerOption[] = [answer, ...distractors].map((s) => ({
    songId: s.id,
    title: s.title,
  }))
  return shuffle(options)
}

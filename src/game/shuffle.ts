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

/** Strip case, punctuation and spacing so titles can be compared for similarity. */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Levenshtein edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[b.length]
}

/** 0..1 similarity ratio between two normalized titles (1 = identical). */
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max
}

const SIMILARITY_LIMIT = 0.8

/**
 * Build 4 answer options for a round: the correct song plus up to 3 distractors
 * drawn from the pool, all shuffled. Distractors are chosen to have distinct
 * titles and to avoid being confusingly similar to the answer or to each other
 * (e.g. "Хару" vs "Хару Хару"). Falls back to relaxed picks for small pools.
 */
export function buildOptions(answer: Song, pool: readonly Song[]): AnswerOption[] {
  const answerNorm = normalizeTitle(answer.title)
  const candidates = shuffle(pool.filter((s) => s.id !== answer.id))
  const usedNorms = new Set<string>([answerNorm])
  const chosen: Song[] = []

  // First pass: distinct titles that are not too similar to the answer or peers.
  for (const c of candidates) {
    if (chosen.length >= 3) break
    const norm = normalizeTitle(c.title)
    if (usedNorms.has(norm)) continue
    const tooSimilar =
      similarity(norm, answerNorm) >= SIMILARITY_LIMIT ||
      chosen.some((ch) => similarity(norm, normalizeTitle(ch.title)) >= SIMILARITY_LIMIT)
    if (tooSimilar) continue
    chosen.push(c)
    usedNorms.add(norm)
  }

  // Second pass: small pool — relax the similarity rule but keep titles distinct.
  if (chosen.length < 3) {
    for (const c of candidates) {
      if (chosen.length >= 3) break
      const norm = normalizeTitle(c.title)
      if (usedNorms.has(norm)) continue
      chosen.push(c)
      usedNorms.add(norm)
    }
  }

  const options: AnswerOption[] = [answer, ...chosen].map((s) => ({
    songId: s.id,
    title: s.title,
  }))
  return shuffle(options)
}

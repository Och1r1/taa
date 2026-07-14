/** Points are halved when a hint was used that round. */
export const HINT_MULTIPLIER = 0.5

/**
 * Kahoot-style scoring: the faster you answer, the more points you earn.
 * A correct answer with the full time remaining earns `maxPoints`; with no
 * time left it earns roughly half. Wrong or timed-out answers earn 0.
 * Using a hint halves the awarded points.
 */
export function computePoints(
  correct: boolean,
  timeLeft: number,
  timePerRound: number,
  maxPoints: number,
  hintUsed = false,
): number {
  if (!correct) return 0
  const fraction = Math.max(0, Math.min(1, timeLeft / timePerRound))
  // Floor at 50% so even a last-second correct answer feels rewarding.
  const base = maxPoints * (0.5 + 0.5 * fraction)
  return Math.round(base * (hintUsed ? HINT_MULTIPLIER : 1))
}

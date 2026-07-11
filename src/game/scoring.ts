/**
 * Kahoot-style scoring: the faster you answer, the more points you earn.
 * A correct answer with the full time remaining earns `maxPoints`; with no
 * time left it earns roughly half. Wrong or timed-out answers earn 0.
 */
export function computePoints(
  correct: boolean,
  timeLeft: number,
  timePerRound: number,
  maxPoints: number,
): number {
  if (!correct || timeLeft <= 0) return correct ? Math.round(maxPoints * 0.5) : 0
  const fraction = Math.max(0, Math.min(1, timeLeft / timePerRound))
  // Floor at 50% so even a last-second correct answer feels rewarding.
  return Math.round(maxPoints * (0.5 + 0.5 * fraction))
}

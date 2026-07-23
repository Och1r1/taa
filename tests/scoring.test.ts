import { describe, expect, it } from 'vitest'
import { computePoints, HINT_MULTIPLIER } from '../src/game/scoring'

describe('computePoints', () => {
  it('awards the maximum for an immediate correct answer', () => {
    expect(computePoints(true, 15, 15, 1000)).toBe(1000)
  })

  it('keeps a minimum half-score for a last-second correct answer', () => {
    expect(computePoints(true, 0, 15, 1000)).toBe(500)
  })

  it('never awards points for wrong answers', () => {
    expect(computePoints(false, 15, 15, 1000)).toBe(0)
  })

  it('applies the hint penalty after speed scoring', () => {
    expect(computePoints(true, 15, 15, 1000, true)).toBe(1000 * HINT_MULTIPLIER)
  })
})

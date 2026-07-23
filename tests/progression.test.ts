import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadProgress, mergeProgress, recordCompletedGame, WEEKLY_GOAL_GAMES } from '../src/lib/progression'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('local player progression', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('records XP, category mastery, and first-game achievement', () => {
    const progress = recordCompletedGame({
      score: 850,
      category: 'song',
      correctCount: 4,
      rounds: 5,
    })
    expect(progress.xp).toBe(10)
    expect(progress.gamesPlayed).toBe(1)
    expect(progress.categoryMastery.song).toEqual({ games: 1, correct: 4, rounds: 5 })
    expect(progress.achievements).toContain('first-game')
  })

  it('does not award daily XP or streak twice on the same date', () => {
    const first = recordCompletedGame({ score: 1000, daily: true, dateKey: '2026-07-23' })
    const replay = recordCompletedGame({ score: 5000, daily: true, dateKey: '2026-07-23' })
    expect(first.dailyStreak).toBe(1)
    expect(replay).toEqual(first)
  })

  it('resets an expired weekly goal while preserving lifetime progress', () => {
    localStorage.setItem('taa.player-progress', JSON.stringify({
      xp: 200,
      gamesPlayed: 8,
      weeklyGames: WEEKLY_GOAL_GAMES,
      weekKey: '2000-W01',
    }))
    const progress = loadProgress()
    expect(progress.xp).toBe(200)
    expect(progress.gamesPlayed).toBe(8)
    expect(progress.weeklyGames).toBe(0)
  })

  it('merges account progress without discarding mastery or achievements', () => {
    const base = loadProgress()
    const merged = mergeProgress(
      { ...base, xp: 300, gamesPlayed: 3, achievements: ['first-game'], categoryMastery: { song: { games: 3, correct: 10, rounds: 15 } } },
      { ...base, xp: 200, gamesPlayed: 5, achievements: ['perfect-game'], categoryMastery: { movie: { games: 2, correct: 8, rounds: 10 } } },
    )
    expect(merged.xp).toBe(300)
    expect(merged.gamesPlayed).toBe(5)
    expect(merged.categoryMastery.song.games).toBe(3)
    expect(merged.categoryMastery.movie.games).toBe(2)
    expect(merged.achievements).toEqual(expect.arrayContaining(['first-game', 'perfect-game']))
  })
})

export interface PlayerProgress {
  xp: number
  level: number
  gamesPlayed: number
  dailyStreak: number
  lastDailyKey: string | null
  weekKey: string
  weeklyGames: number
  categoryMastery: Record<string, { games: number; correct: number; rounds: number }>
  achievements: string[]
}

export const WEEKLY_GOAL_GAMES = 5

const PROGRESS_KEY = 'taa.player-progress'

export function saveProgress(progress: PlayerProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    /* progress remains usable for the current session */
  }
}

export function mergeProgress(local: PlayerProgress, remote: PlayerProgress): PlayerProgress {
  const categoryMastery: PlayerProgress['categoryMastery'] = { ...remote.categoryMastery }
  for (const [category, value] of Object.entries(local.categoryMastery)) {
    const existing = categoryMastery[category] ?? { games: 0, correct: 0, rounds: 0 }
    categoryMastery[category] = {
      games: Math.max(existing.games, value.games),
      correct: Math.max(existing.correct, value.correct),
      rounds: Math.max(existing.rounds, value.rounds),
    }
  }
  const dailyKeys = [local.lastDailyKey, remote.lastDailyKey].filter(Boolean).sort()
  const newestDailyKey = dailyKeys.length > 0 ? dailyKeys[dailyKeys.length - 1] : null
  const merged: PlayerProgress = {
    xp: Math.max(local.xp, remote.xp),
    level: 1,
    gamesPlayed: Math.max(local.gamesPlayed, remote.gamesPlayed),
    dailyStreak: Math.max(local.dailyStreak, remote.dailyStreak),
    lastDailyKey: newestDailyKey,
    weekKey: weekKey(),
    weeklyGames: Math.max(
      local.weekKey === weekKey() ? local.weeklyGames : 0,
      remote.weekKey === weekKey() ? remote.weeklyGames : 0,
    ),
    categoryMastery,
    achievements: [...new Set([...local.achievements, ...remote.achievements])],
  }
  merged.level = levelForXp(merged.xp)
  return merged
}

export function dailyKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function weekKey(date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function previousDay(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return dailyKey(date)
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1
}

export function loadProgress(): PlayerProgress {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null') as Partial<PlayerProgress> | null
    if (parsed) {
      const xp = Number(parsed.xp) || 0
      return {
        xp,
        level: levelForXp(xp),
        gamesPlayed: Number(parsed.gamesPlayed) || 0,
        dailyStreak: Number(parsed.dailyStreak) || 0,
        lastDailyKey: typeof parsed.lastDailyKey === 'string' ? parsed.lastDailyKey : null,
        weekKey: parsed.weekKey === weekKey() ? parsed.weekKey : weekKey(),
        weeklyGames: parsed.weekKey === weekKey() ? Number(parsed.weeklyGames) || 0 : 0,
        categoryMastery: parsed.categoryMastery ?? {},
        achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      }
    }
  } catch {
    // Fall through to a fresh local profile.
  }
  return {
    xp: 0,
    level: 1,
    gamesPlayed: 0,
    dailyStreak: 0,
    lastDailyKey: null,
    weekKey: weekKey(),
    weeklyGames: 0,
    categoryMastery: {},
    achievements: [],
  }
}

export function recordCompletedGame(input: {
  score: number
  category?: string | null
  correctCount?: number
  rounds?: number
  daily?: boolean
  dateKey?: string
}): PlayerProgress {
  const current = loadProgress()
  const key = input.dateKey ?? dailyKey()
  // A daily challenge can be replayed, but it awards streak/XP only once per day.
  if (input.daily && current.lastDailyKey === key) return current
  const xp = current.xp + Math.max(10, Math.round(input.score / 100))
  const category = input.category ?? null
  const previousMastery = category ? current.categoryMastery[category] ?? { games: 0, correct: 0, rounds: 0 } : null
  const categoryMastery = category && previousMastery
    ? {
        ...current.categoryMastery,
        [category]: {
          games: previousMastery.games + 1,
          correct: previousMastery.correct + (input.correctCount ?? 0),
          rounds: previousMastery.rounds + (input.rounds ?? 0),
        },
      }
    : current.categoryMastery
  const dailyStreak = !input.daily
    ? current.dailyStreak
    : current.lastDailyKey === previousDay(key)
      ? current.dailyStreak + 1
      : 1
  const next: PlayerProgress = {
    xp,
    level: levelForXp(xp),
    gamesPlayed: current.gamesPlayed + 1,
    dailyStreak,
    lastDailyKey: input.daily ? key : current.lastDailyKey,
    weekKey: weekKey(),
    weeklyGames: current.weekKey === weekKey() ? current.weeklyGames + 1 : 1,
    categoryMastery,
    achievements: current.achievements,
  }
  const earned = new Set(next.achievements)
  if (next.gamesPlayed >= 1) earned.add('first-game')
  if (next.dailyStreak >= 3) earned.add('daily-streak-3')
  if ((input.rounds ?? 0) > 0 && input.correctCount === input.rounds) earned.add('perfect-game')
  if (category && (categoryMastery[category]?.games ?? 0) >= 10) earned.add(`category-master:${category}`)
  next.achievements = [...earned]
  try {
    saveProgress(next)
  } catch {
    // Playing remains available without local storage.
  }
  return next
}

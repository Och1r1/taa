import { ensureAnonymousUser } from './auth'
import { supabase } from '../lib/supabase'
import type { Category } from '../types'

export interface DailyChallenge {
  id: string
  date: string
  artistSlug: string
  category: Category
  seed: string
  rounds: number
}

export interface DailyLeaderboardEntry {
  playerName: string
  points: number
  correctCount: number
  completedAt: string
}

interface ChallengeRow {
  id: string
  challenge_date: string
  artist_slug: string
  category: Category
  seed: string
  rounds: number
}

interface LeaderboardRow {
  player_name: string
  points: number
  correct_count: number
  completed_at: string
}

function toChallenge(row: ChallengeRow): DailyChallenge {
  return {
    id: row.id,
    date: row.challenge_date,
    artistSlug: row.artist_slug,
    category: row.category,
    seed: row.seed,
    rounds: row.rounds,
  }
}

/** Gets the shared daily record, creating its deterministic server record on first play. */
export async function getDailyChallenge(
  date: string,
  artistSlug: string,
  category: Category,
): Promise<DailyChallenge> {
  const { data, error } = await supabase.rpc('get_or_create_daily_challenge', {
    p_challenge_date: date,
    p_artist_slug: artistSlug,
    p_category: category,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.id) throw new Error('Өнөөдрийн сорилын мэдээлэл буруу байна.')
  return toChallenge(row as ChallengeRow)
}

/** Saves the account's best daily result (anonymous accounts are supported). */
export async function completeDailyChallenge(input: {
  challengeId: string
  points: number
  correctCount: number
}): Promise<void> {
  await ensureAnonymousUser()
  const { error } = await supabase.rpc('complete_daily_challenge', {
    p_challenge_id: input.challengeId,
    p_points: input.points,
    p_correct_count: input.correctCount,
  })
  if (error) throw new Error(error.message)
}

export async function fetchDailyLeaderboard(challengeId: string): Promise<DailyLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('list_daily_challenge_leaderboard', {
    p_challenge_id: challengeId,
    p_limit: 10,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as LeaderboardRow[]).map((row) => ({
    playerName: row.player_name,
    points: row.points,
    correctCount: row.correct_count,
    completedAt: row.completed_at,
  }))
}

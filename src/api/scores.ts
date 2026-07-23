import { supabase } from '../lib/supabase'
import type { Category, ScoreEntry } from '../types'

interface ScoreRow {
  id: string
  player_name: string
  artist_slug: string
  category: Category
  points: number
  correct_count: number
  rounds: number
  created_at: string
  mode?: 'solo' | 'multi' | null
}

interface SaveScoreInput {
  playerName: string
  artistSlug: string
  category: Category
  points: number
  correctCount: number
  rounds: number
}

export interface ScorePage {
  entries: ScoreEntry[]
  hasMore: boolean
}

const SCORE_COLUMNS =
  'id, player_name, artist_slug, category, points, correct_count, rounds, created_at, mode'

/** Insert a finished solo game's score and return the saved entry. */
export async function saveScore(input: SaveScoreInput): Promise<ScoreEntry> {
  const { data, error } = await supabase
    .from('scores')
    .insert({
      player_name: input.playerName.slice(0, 24),
      artist_slug: input.artistSlug,
      category: input.category,
      points: input.points,
      correct_count: input.correctCount,
      rounds: input.rounds,
      mode: 'solo',
    })
    .select(SCORE_COLUMNS)
    .single()

  if (error) throw new Error(`Оноог хадгалж чадсангүй: ${error.message}`)
  return toEntry(data as ScoreRow)
}

/** Top scores for an artist, highest first. */
export async function fetchTopScores(artistSlug: string, limit = 10): Promise<ScoreEntry[]> {
  const { data, error } = await supabase
    .from('scores')
    .select(SCORE_COLUMNS)
    .eq('artist_slug', artistSlug)
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Онооны самбарыг татаж чадсангүй: ${error.message}`)
  return ((data ?? []) as ScoreRow[]).map(toEntry)
}

export type ScoreModeFilter = 'solo' | 'multi'

/** One ordered page of saved category scores; optional solo/multi filter. */
export async function fetchTopScoresForCategory(
  category: Category,
  options: { offset?: number; pageSize?: number; mode?: ScoreModeFilter; since?: string } = {},
): Promise<ScorePage> {
  const { offset = 0, pageSize = 50, mode, since } = options
  let query = supabase
    .from('scores')
    .select(SCORE_COLUMNS)
    .eq('category', category)

  if (mode === 'multi') {
    query = query.eq('mode', 'multi')
  } else if (mode === 'solo') {
    // Legacy rows with null mode count as solo.
    query = query.or('mode.eq.solo,mode.is.null')
  }
  if (since) query = query.gte('created_at', since)

  const { data, error } = await query
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
    .range(offset, offset + pageSize)

  if (error) throw new Error(`Онооны самбарыг татаж чадсангүй: ${error.message}`)
  const rows = (data ?? []) as ScoreRow[]
  return {
    entries: rows.slice(0, pageSize).map(toEntry),
    hasMore: rows.length > pageSize,
  }
}

function toEntry(row: ScoreRow): ScoreEntry {
  return {
    id: row.id,
    playerName: row.player_name,
    artistSlug: row.artist_slug,
    category: row.category,
    points: row.points,
    correctCount: row.correct_count,
    rounds: row.rounds,
    createdAt: row.created_at,
    mode: row.mode === 'multi' ? 'multi' : 'solo',
  }
}

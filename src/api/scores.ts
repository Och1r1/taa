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
}

interface SaveScoreInput {
  playerName: string
  artistSlug: string
  category: Category
  points: number
  correctCount: number
  rounds: number
}

/** Insert a finished game's score and return the saved entry. */
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
    })
    .select()
    .single()

  if (error) throw new Error(`Оноог хадгалж чадсангүй: ${error.message}`)
  return toEntry(data as ScoreRow)
}

/** Top scores for an artist, highest first. */
export async function fetchTopScores(artistSlug: string, limit = 10): Promise<ScoreEntry[]> {
  const { data, error } = await supabase
    .from('scores')
    .select('id, player_name, artist_slug, category, points, correct_count, rounds, created_at')
    .eq('artist_slug', artistSlug)
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Онооны самбарыг татаж чадсангүй: ${error.message}`)
  return ((data ?? []) as ScoreRow[]).map(toEntry)
}

/** Every saved score in one category, highest first. */
export async function fetchTopScoresForCategory(category: Category): Promise<ScoreEntry[]> {
  const { data, error } = await supabase
    .from('scores')
    .select('id, player_name, artist_slug, category, points, correct_count, rounds, created_at')
    .eq('category', category)
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Онооны самбарыг татаж чадсангүй: ${error.message}`)
  return ((data ?? []) as ScoreRow[]).map(toEntry)
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
  }
}

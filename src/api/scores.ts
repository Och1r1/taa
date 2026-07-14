import { supabase } from '../lib/supabase'
import type { ScoreEntry } from '../types'

interface ScoreRow {
  id: string
  player_name: string
  artist_slug: string
  points: number
  correct_count: number
  rounds: number
  created_at: string
}

interface SaveScoreInput {
  playerName: string
  artistSlug: string
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
    .select('id, player_name, artist_slug, points, correct_count, rounds, created_at')
    .eq('artist_slug', artistSlug)
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Онооны самбарыг татаж чадсангүй: ${error.message}`)
  return ((data ?? []) as ScoreRow[]).map(toEntry)
}

/** Top scores across every artist, highest first (the global leaderboard). */
export async function fetchGlobalTopScores(limit = 25): Promise<ScoreEntry[]> {
  const { data, error } = await supabase
    .from('scores')
    .select('id, player_name, artist_slug, points, correct_count, rounds, created_at')
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Онооны самбарыг татаж чадсангүй: ${error.message}`)
  return ((data ?? []) as ScoreRow[]).map(toEntry)
}

function toEntry(row: ScoreRow): ScoreEntry {
  return {
    id: row.id,
    playerName: row.player_name,
    artistSlug: row.artist_slug,
    points: row.points,
    correctCount: row.correct_count,
    rounds: row.rounds,
    createdAt: row.created_at,
  }
}

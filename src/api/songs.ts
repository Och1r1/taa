import { supabase, AUDIO_BUCKET } from '../lib/supabase'
import type { Song } from '../types'

interface SongRow {
  id: string
  artist_id: string
  title: string
  audio_path: string
  snippet_start: number
  snippet_duration: number
}

/**
 * Fetch all songs for an artist (by slug) and resolve each audio_path to a
 * public Storage URL. Throws with a readable message on failure.
 */
export async function fetchSongsByArtistSlug(slug: string): Promise<Song[]> {
  const { data: artist, error: artistError } = await supabase
    .from('artists')
    .select('id')
    .eq('slug', slug)
    .single()

  if (artistError || !artist) {
    throw new Error(
      `Уран бүтээлч "${slug}" олдсонгүй. Supabase-д seed.sql ажиллуулсан эсэхээ шалгана уу.`,
    )
  }

  const { data, error } = await supabase
    .from('songs')
    .select('id, artist_id, title, audio_path, snippet_start, snippet_duration')
    .eq('artist_id', artist.id)

  if (error) {
    throw new Error(`Дуунуудыг татаж чадсангүй: ${error.message}`)
  }

  const rows = (data ?? []) as SongRow[]

  return rows.map((row) => ({
    id: row.id,
    artistId: row.artist_id,
    title: row.title,
    audioUrl: resolveAudioUrl(row.audio_path),
    snippetStart: Number(row.snippet_start) || 0,
    snippetDuration: Number(row.snippet_duration) || 15,
  }))
}

/** Resolve a Storage object path to a public URL. */
function resolveAudioUrl(path: string): string {
  const { data } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

import { supabase, AUDIO_BUCKET } from '../lib/supabase'
import type { ArtistOption, Category, MediaType, Song } from '../types'

interface SongRow {
  id: string
  artist_id: string
  title: string
  audio_path: string
  media_type: MediaType
  snippet_start: number
  snippet_duration: number
}

interface ArtistRow {
  id: string
  name: string
  slug: string
  category: Category
  songs: { count: number }[]
}

/**
 * Fetch packs (artists/collections), optionally filtered by category, along with
 * their item count so the home screen can offer a picker. New packs added via the
 * ingestion pipeline appear here automatically.
 */
export async function fetchArtists(category?: Category): Promise<ArtistOption[]> {
  let query = supabase.from('artists').select('id, name, slug, category, songs(count)').order('name')
  if (category) query = query.eq('category', category)

  const { data, error } = await query

  if (error) {
    throw new Error(`Багцуудыг татаж чадсангүй: ${error.message}`)
  }

  return ((data ?? []) as ArtistRow[]).map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    category: a.category ?? 'song',
    songCount: a.songs?.[0]?.count ?? 0,
  }))
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
    .select('id, artist_id, title, audio_path, media_type, snippet_start, snippet_duration')
    .eq('artist_id', artist.id)

  if (error) {
    throw new Error(`Дуунуудыг татаж чадсангүй: ${error.message}`)
  }

  const rows = (data ?? []) as SongRow[]

  return rows.map((row) => ({
    id: row.id,
    artistId: row.artist_id,
    title: row.title,
    mediaType: row.media_type ?? 'audio',
    mediaUrl: resolveMediaUrl(row.audio_path),
    snippetStart: Number(row.snippet_start) || 0,
    snippetDuration: Number(row.snippet_duration) || 15,
  }))
}

/** Resolve a Storage object path to a public URL. */
function resolveMediaUrl(path: string): string {
  const { data } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

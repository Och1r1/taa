#!/usr/bin/env node
/**
 * Таа — song ingestion pipeline (trim-first).
 *
 * For each song in an input JSON file:
 *   1. Resolve a YouTube video (explicit URL/videoId, or search via the YouTube Data API).
 *   2. Download ONLY a ~15s section with yt-dlp + ffmpeg (so we store a tiny clip, not the full song).
 *   3. Upload the clip to the Supabase Storage bucket.
 *   4. Insert a `songs` row (snippet_start = 0, since the stored file IS the snippet).
 *
 * Idempotent: songs already present (same artist + title) are skipped unless --force.
 *
 * Usage:
 *   node --env-file=.env.local scripts/ingest.mjs [path/to/songs.json] [--force]
 *
 * Requires (in .env.local, NOT VITE_-prefixed so they never reach the client bundle):
 *   VITE_SUPABASE_URL (reused)   or  SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY    (bypasses RLS to write — keep secret)
 *   YOUTUBE_API_KEY              (only needed for songs that use `query` search or auto start offset)
 *   VITE_SUPABASE_AUDIO_BUCKET   (optional, defaults to "song-audio")
 *
 * System prerequisites: `yt-dlp` and `ffmpeg` on PATH (brew install yt-dlp ffmpeg).
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

// supabase-js initializes a Realtime client that needs a global WebSocket.
// Node < 22 has none; we don't use Realtime here, but createClient still needs it.
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket

const execFileAsync = promisify(execFile)

// ── Config from env ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY
const BUCKET = process.env.VITE_SUPABASE_AUDIO_BUCKET || 'song-audio'

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const inputPath = args.find((a) => !a.startsWith('--')) || 'scripts/songs.vandebo.json'

// ── Small helpers ────────────────────────────────────────────────────────────
const log = (...m) => console.log(...m)
const die = (msg) => {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

function slugify(text) {
  const s = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s
}

/** Extract a YouTube video id from a URL or return the string if it already looks like an id. */
function extractVideoId(urlOrId) {
  if (!urlOrId) return null
  const m = String(urlOrId).match(
    /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/,
  )
  return m ? m[1] || m[2] : null
}

/** Parse an ISO-8601 duration (e.g. PT3M42S) into seconds. */
function iso8601ToSeconds(iso) {
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + +(m[3] || 0)
}

async function ytSearchVideoId(query) {
  if (!YOUTUBE_API_KEY) die(`Song uses "query" ("${query}") but YOUTUBE_API_KEY is not set.`)
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.search = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: '1',
    key: YOUTUBE_API_KEY,
  }).toString()
  const res = await fetch(url)
  if (!res.ok) die(`YouTube search failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const item = data.items?.[0]
  if (!item) die(`No YouTube result for query "${query}".`)
  return { videoId: item.id.videoId, title: item.snippet.title }
}

async function ytVideoDurationSeconds(videoId) {
  if (!YOUTUBE_API_KEY) return null
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.search = new URLSearchParams({
    part: 'contentDetails',
    id: videoId,
    key: YOUTUBE_API_KEY,
  }).toString()
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const iso = data.items?.[0]?.contentDetails?.duration
  return iso ? iso8601ToSeconds(iso) : null
}

const YT = (videoId) => `https://www.youtube.com/watch?v=${videoId}`

/** Download only [start, start+duration] of a video as a 128k mp3. */
async function downloadAudioClip(videoId, start, duration, outBase) {
  await execFileAsync(
    'yt-dlp',
    [
      '--quiet', '--no-warnings',
      '-x', '--audio-format', 'mp3', '--audio-quality', '128K',
      '--download-sections', `*${start}-${start + duration}`,
      '--force-keyframes-at-cuts',
      '-o', `${outBase}.%(ext)s`,
      YT(videoId),
    ],
    { maxBuffer: 1024 * 1024 * 64 },
  )
  const out = `${outBase}.mp3`
  if (!existsSync(out)) die(`yt-dlp did not produce ${out}`)
  return out
}

/** Download only [start, start+duration] of a video as a ≤360p h264 mp4. */
async function downloadVideoClip(videoId, start, duration, outBase) {
  await execFileAsync(
    'yt-dlp',
    [
      '--quiet', '--no-warnings',
      '-S', 'res:360,codec:h264',
      '--download-sections', `*${start}-${start + duration}`,
      '--force-keyframes-at-cuts',
      '--remux-video', 'mp4', '--merge-output-format', 'mp4',
      '-o', `${outBase}.%(ext)s`,
      YT(videoId),
    ],
    { maxBuffer: 1024 * 1024 * 128 },
  )
  const out = `${outBase}.mp4`
  if (!existsSync(out)) die(`yt-dlp did not produce ${out}`)
  return out
}

/** Download an image from a direct URL and save it as a .jpg. */
async function downloadImageFromUrl(imageUrl, outBase) {
  const res = await fetch(imageUrl)
  if (!res.ok) die(`Image fetch failed (${res.status}) for ${imageUrl}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const out = `${outBase}.jpg`
  await writeFile(out, buf)
  return out
}

/** Grab a single frame from a video at `start` as a .jpg (fallback for actors). */
async function extractFrameFromVideo(videoId, start, outBase) {
  const clip = await downloadVideoClip(videoId, start, 2, `${outBase}-src`)
  const out = `${outBase}.jpg`
  await execFileAsync('ffmpeg', ['-y', '-i', clip, '-frames:v', '1', '-q:v', '3', out])
  if (!existsSync(out)) die(`ffmpeg did not produce ${out}`)
  return out
}

/** Default media type for a category. */
function mediaForCategory(category) {
  if (category === 'movie') return 'video'
  if (category === 'actor') return 'image'
  return 'audio'
}

const MEDIA_META = {
  audio: { ext: 'mp3', contentType: 'audio/mpeg' },
  video: { ext: 'mp4', contentType: 'video/mp4' },
  image: { ext: 'jpg', contentType: 'image/jpeg' },
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    die(
      'Missing Supabase config. Set VITE_SUPABASE_URL (or SUPABASE_URL) and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local, and run with: ' +
        'node --env-file=.env.local scripts/ingest.mjs',
    )
  }

  // Fail fast if yt-dlp is missing.
  try {
    await execFileAsync('yt-dlp', ['--version'])
  } catch {
    die('yt-dlp not found on PATH. Install it with: brew install yt-dlp ffmpeg')
  }

  const config = JSON.parse(await readFile(inputPath, 'utf8'))
  const { artist, songs, defaults = {} } = config
  if (!artist?.slug || !Array.isArray(songs)) {
    die(`Invalid input file ${inputPath}: expected { artist: {name, slug}, songs: [...] }`)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const category = artist.category || 'song'

  // Upsert the pack (artist/collection) and get its id.
  const { error: upErr } = await supabase
    .from('artists')
    .upsert({ name: artist.name, slug: artist.slug, category }, { onConflict: 'slug' })
  if (upErr) die(`Failed to upsert pack: ${upErr.message}`)
  const { data: artistRow, error: aErr } = await supabase
    .from('artists')
    .select('id')
    .eq('slug', artist.slug)
    .single()
  if (aErr || !artistRow) die(`Failed to read pack: ${aErr?.message}`)
  const artistId = artistRow.id
  const { error: difficultyColumnError } = await supabase.from('songs').select('difficulty').limit(1)
  const supportsDifficulty = !difficultyColumnError
  if (!supportsDifficulty) {
    log('  ℹ️  content-ops.sql is not applied; ingesting without difficulty metadata')
  }

  log(`\n🎬 Ingesting ${songs.length} item(s) for "${artist.name}" (${artist.slug}, ${category})\n`)

  let added = 0
  let skipped = 0
  for (const song of songs) {
    const label = song.title || song.query || '(untitled)'
    try {
      // Skip if already present (unless --force).
      const { data: existing } = await supabase
        .from('songs')
        .select('id')
        .eq('artist_id', artistId)
        .eq('title', song.title)
        .maybeSingle()
      if (existing && !FORCE) {
        log(`  ⏭  ${label} — already exists, skipping`)
        skipped++
        continue
      }

      const mediaType = song.mediaType || mediaForCategory(category)
      const duration = song.duration ?? defaults.duration ?? 15
      const slug = slugify(song.slug || song.title) || 'item'
      const outBase = join(tmpdir(), `taa-${artist.slug}-${slug}`)
      const { ext, contentType } = MEDIA_META[mediaType]

      let resolvedTitle = song.title
      let mediaPath

      if (mediaType === 'image' && song.imageUrl) {
        // Direct image URL — no YouTube needed.
        log(`  ⬇   ${label} — image`)
        mediaPath = await downloadImageFromUrl(song.imageUrl, outBase)
      } else {
        // Resolve a YouTube video for audio/video, or the actor frame fallback.
        let videoId = extractVideoId(song.videoId || song.youtubeUrl)
        if (!videoId) {
          const found = await ytSearchVideoId(song.query || song.title)
          videoId = found.videoId
          resolvedTitle = song.title || found.title
          log(`  🔎  ${label} → video ${videoId}`)
        }
        let start = song.start
        if (start == null) {
          const total = await ytVideoDurationSeconds(videoId)
          start = total ? Math.floor(total * 0.3) : 30 // ~30% in, past the intro
        }
        if (mediaType === 'video') {
          log(`  ⬇   ${label} — video clip ${start}s–${start + duration}s ≤360p`)
          mediaPath = await downloadVideoClip(videoId, start, duration, outBase)
        } else if (mediaType === 'image') {
          log(`  ⬇   ${label} — frame @${start}s`)
          mediaPath = await extractFrameFromVideo(videoId, start, outBase)
        } else {
          log(`  ⬇   ${label} — audio clip ${start}s–${start + duration}s @128k`)
          mediaPath = await downloadAudioClip(videoId, start, duration, outBase)
        }
      }

      // Upload to Storage.
      const objectPath = `${artist.slug}/${slug}.${ext}`
      const bytes = await readFile(mediaPath)
      const { error: sErr } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, bytes, { contentType, upsert: true })
      if (sErr) throw new Error(`Storage upload failed: ${sErr.message}`)

      // Insert (or update) the DB row. snippet_start = 0 because the file is the clip.
      const difficulty = Number(song.difficulty ?? defaults.difficulty ?? 2)
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
        throw new Error('difficulty must be an integer from 1 (easy) to 5 (expert)')
      }
      const row = {
        artist_id: artistId,
        title: resolvedTitle,
        audio_path: objectPath,
        media_type: mediaType,
        snippet_start: 0,
        snippet_duration: duration,
        ...(supportsDifficulty ? { difficulty } : {}),
      }
      if (existing) {
        const { error } = await supabase.from('songs').update(row).eq('id', existing.id)
        if (error) throw new Error(`DB update failed: ${error.message}`)
      } else {
        const { error } = await supabase.from('songs').insert(row)
        if (error) throw new Error(`DB insert failed: ${error.message}`)
      }

      const kb = Math.round(bytes.length / 1024)
      log(`  ✅  ${resolvedTitle} — ${objectPath} (${kb} KB)`)
      added++
    } catch (err) {
      console.error(`  ✖  ${label} — ${err.message}`)
    }
  }

  log(`\nDone. ${added} added/updated, ${skipped} skipped.\n`)
}

main().catch((e) => die(e.stack || String(e)))

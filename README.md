# Таа · Guess everything

A Kahoot-style "guess the Mongolian song" game. A snippet of a song plays; you pick the
correct title from 4 options; faster answers earn more points. **Today's scope:** single-player,
one artist (Вандебо / Vandebo).

## Stack

- **Vite + React 18 + TypeScript**
- **Tailwind CSS** (dark theme from the design mockup)
- **Supabase** — song metadata (Postgres) + audio files (Storage)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev                  # http://localhost:5173
```

### Supabase setup (required for audio + songs)

1. **Create a project** at [supabase.com](https://supabase.com). From
   **Project Settings → API**, copy the **Project URL** and **anon public key** into `.env.local`.
2. **Create a public Storage bucket** named `song-audio` (Storage → New bucket → Public).
   Upload Vandebo `.mp3` snippet files, e.g. into a `vandebo/` folder.
3. For multiplayer, enable **Authentication → Providers → Anonymous** in the Supabase dashboard.
   Players are signed in anonymously when they create or join a room; no sign-up is shown.
4. **Run the SQL** in the SQL Editor, in order:
   - `supabase/schema.sql` — creates `artists` + `songs` tables and read-only RLS policies.
   - `supabase/seed.sql` — inserts Vandebo + songs. **Edit the `audio_path` / `title` values
     to match the files you actually uploaded** before running.
   - `supabase/leaderboard.sql` — creates the `scores` table + policies for the persistent
     leaderboard (Онооны самбар). Safe to run once; no editing needed.
   - `supabase/category-leaderboard.sql` — adds category-specific leaderboard support and
     backfills existing scores. Run this after `media.sql` for an existing project.
   - `supabase/category-catalog.sql` — creates the active-category catalog used by the
     leaderboard. Run this after `media.sql` and `category-leaderboard.sql`.
   - `supabase/rooms.sql` → `rooms-game.sql` → `rooms-polish.sql` → `rooms-auth.sql` →
     `rooms-leaderboard.sql` → `rooms-private-spectators.sql` → `rooms-profiles.sql` →
     `rooms-rematch.sql` → `rooms-rls-auth-host.sql` — multiplayer through Auth-only host,
     participant SELECT RLS, rematch, profiles, private invites, and spectators.

That's it — reload the app and start a game.

### Adding a category

Categories are data-driven. Add a row to `categories`, then create one or more matching packs in
`artists` and media items in `songs`; the Home screen and leaderboard will show it automatically.
Set `media_type` to `audio`, `video`, or `image` so all items in its packs use the correct format.

```sql
insert into categories (slug, name, icon, subtitle, accent, display_order, media_type)
values ('web-series', 'Веб цуврал', '💻', 'Хэсгээр нь таа', '#34d399', 50, 'video');
```

## Adding songs (automated ingestion)

Instead of hand-editing SQL and uploading full songs, `scripts/ingest.mjs` downloads **only a
~15-second clip** of each song and seeds it. Storing clips (~120–235 KB) instead of full tracks
(~5 MB) raises the free-tier ceiling from ~200 songs to several thousand.

**One-time setup:**

```bash
brew install yt-dlp ffmpeg          # system tools that fetch + trim audio
```

Add two server-side secrets to `.env.local` (see `.env.example`) — these are **not** `VITE_`-prefixed
so they never reach the browser:

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → `service_role` (keep secret).
- `YOUTUBE_API_KEY` — only needed for songs listed with a search `query`.

**Add songs:** edit `scripts/songs.vandebo.json`. Each song needs a `title` and either a
`youtubeUrl`/`videoId` (no API key needed) or a `query` (uses the YouTube API to find it).
Optionally set `start` (seconds into the track; defaults to ~30% in) and `slug` (the stored filename).

```jsonc
{ "title": "Цагийн Ово", "slug": "tsagiin-ovoo", "youtubeUrl": "https://youtu.be/…", "start": 45 }
```

**Run it:**

```bash
npm run ingest                       # uses scripts/songs.vandebo.json
npm run ingest -- path/to/other.json # a different list
npm run ingest -- --force            # re-download songs that already exist
```

It's idempotent — songs already in the DB are skipped unless `--force`. `snippet_start` is `0`
because the stored file *is* the snippet, so no app changes are needed.

### Categories & media types (movies, actors)

Run `supabase/media.sql` once to enable categories. A pack (`artist`) carries a `category`
(`song` | `cartoon` | `movie` | `actor`) and each item a `media_type` (`audio` | `video` | `image`,
inferred from the category). The same pipeline handles all three:

- **Songs / cartoons** → 15s **audio** clip (mp3, ~200 KB).
- **Movies** → short **video** clip (≤360p h264 mp4, ~0.5–1.5 MB) via YouTube. See `scripts/movies.json`.
- **Actors** → an **image**: give an `imageUrl` (downloaded as jpg), or a `youtubeUrl` + `start`
  and a single frame is extracted with ffmpeg. See `scripts/actors.json`.

```bash
npm run ingest -- scripts/movies.json   # video clips → Кино category
npm run ingest -- scripts/actors.json   # photos → Жүжигчин category
```

## How it works

- `src/game/useGameEngine.ts` — the game state machine (idle → playing → revealed → gameover),
  round generation, timer, and scoring.
- `src/game/scoring.ts` — Kahoot-style points: correct + fast = up to `maxPoints`.
- `src/api/songs.ts` — fetches songs for an artist and resolves Storage audio URLs.
- `src/screens/` — Home, Game, Results.

## Roadmap

- Multiplayer (Хамтдаа): rooms, invite links, synced rounds via Supabase Realtime.
- Persistent leaderboards + accounts (Supabase Auth).
- More categories: cartoons, movies, TV shows, actors, web series (image/video clips).
- More artists / genres / playlists; content admin; Discord Activity.

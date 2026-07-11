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
3. **Run the SQL** in the SQL Editor, in order:
   - `supabase/schema.sql` — creates `artists` + `songs` tables and read-only RLS policies.
   - `supabase/seed.sql` — inserts Vandebo + songs. **Edit the `audio_path` / `title` values
     to match the files you actually uploaded** before running.

That's it — reload the app and start a game.

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

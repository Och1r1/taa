# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Таа" (Guess everything) — Kahoot-style guessing game. Snippet plays (audio/video/image reveal),
player picks correct answer from 4 options, faster answers score more. Single-player and
real-time multiplayer (room/lobby with PIN join). Vite + React 18 + TypeScript + Tailwind +
Supabase (Postgres + Storage + Auth, all game state driven by Postgres RPCs and Realtime).

## Commands

```bash
npm run dev              # Vite dev server, http://localhost:5173
npm run build             # tsc -b (project references) + vite build — run before opening a PR
npm run preview           # serve the production build locally
npm test                  # vitest run, loads .env.local (needed for live Supabase RPC tests)
npm run test:unit         # vitest run without .env.local
npm run ingest [file]      # scripts/ingest.mjs — download/trim/upload a song manifest to Supabase
```

Single test file: `npx vitest run tests/rpc.rooms.test.ts`. Tests live in `tests/*.test.ts` (see
`vitest.config.ts`); the multiplayer RPC suite (`tests/rpc.rooms.test.ts`) is a `describe.skipIf`
that only runs live against Supabase when `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` are all set in `.env.local` — otherwise it no-ops.

There is no lint script configured; rely on `tsc -b` (strict mode, no unused locals/params) as the
gate.

## Architecture

### Screen flow (`src/App.tsx`)
Single top-level state machine, no router. `App` branches on `engine.phase`
(`idle` → `gameover`, else in-game) and, while idle, on whether a `multiSession` (room/PIN join)
is active. `MultiSessionGate` further branches multiplayer between `LobbyScreen` (pre-game) and
`MultiGameScreen` (live), driven purely by `room.status` from `useRoomLobby`'s single Realtime
subscription — there's deliberately one source of truth for lobby vs. in-game, not separate
polling.

### Two parallel game engines
- **Single-player**: `src/game/useGameEngine.ts` — local phase/timer/score state, no network
  except fetching songs.
- **Multiplayer**: `src/game/useMultiGame.ts` — mirrors server-authoritative state from Supabase
  Realtime (room, players, rounds, answers); the client never computes scores/outcomes itself for
  multiplayer, it reflects what the RPCs decided.

Both produce a `GameConfig`/round set consumed by `GameScreen` / `MultiGameScreen`, which share
presentational pieces (`MediaStage`, `OptionCard`, `TimerBar`, `EqualizerBars`) for
audio/video/image reveal.

### Supabase is the multiplayer authority
`src/api/rooms.ts` is a thin RPC client, not business logic — room creation, joining, starting
rounds, submitting answers, rematch, etc. all call Postgres functions (`create_room`, `join_room`,
...) defined in `supabase/*.sql`. Correctness (scoring, host permissions, RLS, rate limits) lives
in SQL, applied in the numbered order documented in `README.md` (`schema.sql` → ... →
`rooms-rate-limits.sql`). When touching multiplayer behavior, check whether the fix belongs in the
RPC/SQL layer rather than the client.

Auth is anonymous-only (`src/api/auth.ts`, `ensureAnonymousUser`) — players are signed in
anonymously to join/host rooms; there is no user-facing sign-up.

### Data model layering
- `src/api/*.ts` isolates all Supabase access (songs, categories, scores, rooms, auth) — screens
  and game hooks must not call `supabase` directly; go through `src/lib/supabase.ts` via these
  modules.
- `src/types.ts` holds shared domain types (Song, GameConfig, GameRoom, RoomPlayer, RoundOutcome,
  etc.) used across api/game/screens.
- Categories are data-driven (`categories` table + `media_type`: `audio`/`video`/`image`), not
  hardcoded — adding a new guessing category is a data change (see README "Adding a category"),
  not a code change.

### Media ingestion (`scripts/ingest.mjs`)
Populates Supabase from a JSON manifest (e.g. `scripts/songs.vandebo.json`): downloads a short
clip via yt-dlp/ffmpeg (not the full track — this is what keeps Storage usage low on the free
tier), uploads to the `song-audio` bucket, and seeds the row. Idempotent by default; `--force`
re-downloads existing entries. Requires `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
`VITE_`-prefixed) in `.env.local`.

## Coding style

TypeScript strict mode; two-space indent, single quotes, no semicolons, trailing commas in
multiline calls. PascalCase for components/screens, camelCase for functions/hooks
(`useGameEngine`). Keep all Supabase calls behind `src/api/`.

## Data safety

Never commit `.env.local` or the service-role key. Only `VITE_`-prefixed env vars are safe to
reach the browser bundle; `SUPABASE_SERVICE_ROLE_KEY` and `YOUTUBE_API_KEY` must stay server-side
(ingestion script only).

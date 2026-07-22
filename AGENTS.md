# Repository Guidelines

## Project Structure & Module Organization

This is a Vite, React 18, and TypeScript game application. Application code lives in `src/`:

- `screens/` contains page-level UI such as `HomeScreen.tsx` and `GameScreen.tsx`.
- `components/` contains reusable presentational controls.
- `game/` owns game state, scoring, and selection logic; keep gameplay rules here.
- `api/` and `lib/supabase.ts` isolate Supabase access.
- `audio/` contains browser audio hooks, while `types.ts` holds shared domain types.

Database schema and seed SQL are in `supabase/`. The `scripts/` directory contains ingestion tooling and JSON media manifests, for example `scripts/songs.vandebo.json`.

## Build, Test, and Development Commands

- `npm install` installs the pinned project dependencies.
- `npm run dev` starts the Vite development server (normally `http://localhost:5173`).
- `npm run build` runs TypeScript project checks and creates a production Vite build.
- `npm run preview` serves the built application locally.
- `npm run ingest -- scripts/movies.json` fetches, trims, uploads, and seeds a media manifest. Use `.env.local` server-side credentials first.

There is no automated test runner configured currently. Before opening a change, run `npm run build` and manually exercise the relevant game flow in `npm run dev`. Add focused tests alongside new logic when introducing a test framework; name them after the unit or behavior being tested (for example, `scoring.test.ts`).

## Coding Style & Naming Conventions

Use TypeScript with strict typing; the compiler rejects unused locals and parameters. Follow the existing style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline calls. Name React components and screens in PascalCase (`MediaStage.tsx`); use camelCase for functions, variables, and hooks (`useGameEngine`). Keep Supabase calls behind `src/api/` rather than embedding them in UI components.

## Configuration & Data Safety

Copy `.env.example` to `.env.local`; never commit `.env.local`, service-role keys, or API keys. Browser-visible values use the `VITE_` prefix. Apply SQL in `supabase/` in the README’s documented order, and verify `audio_path` values match uploaded Storage objects before seeding.

## Commits & Pull Requests

Recent commits use short imperative subjects, such as `Add header nav and visual categories (movies + actors)`. Keep commits focused and describe the user-visible change. Pull requests should explain the behavior change, link the relevant issue when available, state how `npm run build` was verified, and include screenshots for UI changes. Call out required Supabase schema, seed, or environment changes explicitly.

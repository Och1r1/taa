-- Таа — leaderboard (Онооны самбар)
-- Run this in the Supabase SQL editor after schema.sql.
-- Stores one row per finished solo game so we can show a persistent high-score board.

create table if not exists public.scores (
  id            uuid primary key default gen_random_uuid(),
  player_name   text not null check (char_length(player_name) between 1 and 24),
  artist_slug   text not null,
  points        integer not null check (points >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  rounds        integer not null default 0 check (rounds >= 0),
  created_at    timestamptz not null default now()
);

-- Fast "top scores for this artist" reads.
create index if not exists scores_artist_points_idx
  on public.scores (artist_slug, points desc);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Public game with no accounts: anyone may read the board and submit a score.
-- (Prototype-grade — a determined user could submit fake scores. Tighten with
-- auth / an edge function before any competitive/public launch.)

alter table public.scores enable row level security;

drop policy if exists "scores are readable by everyone" on public.scores;
create policy "scores are readable by everyone"
  on public.scores for select
  using (true);

drop policy if exists "anyone can submit a score" on public.scores;
create policy "anyone can submit a score"
  on public.scores for insert
  with check (
    char_length(player_name) between 1 and 24
    and points >= 0
  );

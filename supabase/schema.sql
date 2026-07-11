-- Таа — database schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: uses IF NOT EXISTS / idempotent policy drops.

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.artists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.songs (
  id               uuid primary key default gen_random_uuid(),
  artist_id        uuid not null references public.artists (id) on delete cascade,
  title            text not null,
  -- Object path inside the `song-audio` Storage bucket, e.g. 'vandebo/tsagiin-ovoo.mp3'
  audio_path       text not null,
  -- Where in the track the snippet starts, in seconds.
  snippet_start    numeric not null default 0,
  -- How long the snippet plays, in seconds.
  snippet_duration numeric not null default 15,
  created_at       timestamptz not null default now()
);

create index if not exists songs_artist_id_idx on public.songs (artist_id);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Read-only game: allow anonymous SELECT, no client-side writes.

alter table public.artists enable row level security;
alter table public.songs   enable row level security;

drop policy if exists "artists are readable by everyone" on public.artists;
create policy "artists are readable by everyone"
  on public.artists for select
  using (true);

drop policy if exists "songs are readable by everyone" on public.songs;
create policy "songs are readable by everyone"
  on public.songs for select
  using (true);

-- Content-operations metadata. Apply after media.sql.
-- Difficulty is editorial metadata used to balance future packs and report gaps.

alter table public.songs
  add column if not exists difficulty smallint not null default 2;

alter table public.songs drop constraint if exists songs_difficulty_check;
alter table public.songs
  add constraint songs_difficulty_check check (difficulty between 1 and 5);

alter table public.artists
  add column if not exists is_featured boolean not null default false,
  add column if not exists release_note text;

create index if not exists songs_artist_difficulty_idx
  on public.songs (artist_id, difficulty);
create index if not exists artists_featured_idx
  on public.artists (is_featured, category, name);

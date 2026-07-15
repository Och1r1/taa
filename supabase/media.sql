-- Таа — generalize songs into media items (audio / video / image)
-- Run this in the Supabase SQL editor AFTER schema.sql. Safe to re-run.
--
-- This makes the game support visual categories (movies via video clips,
-- actors via photos) in addition to audio songs, without a new table:
--   * a pack (artists row) gets a `category`
--   * an item (songs row) gets a `media_type`
-- `audio_path` is reused as the generic media path (holds .mp3 / .mp4 / .jpg).

alter table public.artists
  add column if not exists category text not null default 'song';

alter table public.songs
  add column if not exists media_type text not null default 'audio';

-- Constrain to known values (drop-then-add so it's idempotent).
alter table public.artists drop constraint if exists artists_category_check;
alter table public.artists
  add constraint artists_category_check
  check (category in ('song', 'cartoon', 'movie', 'actor'));

alter table public.songs drop constraint if exists songs_media_type_check;
alter table public.songs
  add constraint songs_media_type_check
  check (media_type in ('audio', 'video', 'image'));

-- Existing rows already default to 'song' / 'audio', so audio songs keep working.

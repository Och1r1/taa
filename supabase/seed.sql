-- Таа — seed data (Vandebo)
-- Run AFTER schema.sql, and AFTER uploading the .mp3 files to the `song-audio` bucket.
--
-- IMPORTANT: `audio_path` must match the object path you uploaded in Storage.
-- Example: if you uploaded to bucket `song-audio` at folder `vandebo/`, the path
-- for a file named `tsagiin-ovoo.mp3` is 'vandebo/tsagiin-ovoo.mp3'.
-- Adjust the paths / titles below to match your actual files.

-- Upsert the artist.
insert into public.artists (name, slug)
values ('Вандебо', 'vandebo')
on conflict (slug) do nothing;

-- Insert songs, linking to the Vandebo artist by slug.
-- Re-running is safe: existing (artist_id, title) rows are skipped.
with a as (
  select id from public.artists where slug = 'vandebo'
)
insert into public.songs (artist_id, title, audio_path, snippet_start, snippet_duration)
select a.id, v.title, v.audio_path, v.snippet_start, v.snippet_duration
from a
cross join (values
  ('Мөнгө бол тоо',    'vandebo/munguboltoo.mp3',   30, 15),
  ('Дөнгөн данган',  'vandebo/dungundangan.mp3', 30, 15),
  ('Сэрүүлэг',       'vandebo/seruuleg.mp3',        30, 15),
  ('Хару Хару',  'vandebo/haruharu.mp3',  30, 15),
  ('Яаанаа',          'vandebo/yaanaa.mp3',           30, 15),
  ('Broke and Down',         'vandebo/broke&down.mp3',          30, 15),
  ('Too Deep',          'vandebo/toodeep.mp3',           30, 15),
  ('Намайг Тоо',      'vandebo/namaigtoo.mp3',      30, 15)
) as v(title, audio_path, snippet_start, snippet_duration)
where not exists (
  select 1 from public.songs s
  where s.artist_id = a.id and s.title = v.title
);

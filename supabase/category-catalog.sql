-- Таа — data-driven category catalog
-- Run after media.sql and category-leaderboard.sql.
-- Add future categories by inserting a row here; no leaderboard UI code change is needed.

create table if not exists public.categories (
  slug          text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name          text not null check (char_length(name) between 1 and 60),
  icon          text not null default '🎮' check (char_length(icon) between 1 and 16),
  subtitle      text not null default 'Таньж таа',
  accent        text not null default '#22d3ee',
  picker_label  text not null default 'Багц',
  item_label    text not null default 'асуулт',
  empty_message text not null default 'Багц алга байна.',
  display_order integer not null default 0,
  is_active     boolean not null default true,
  media_type    text check (media_type in ('audio', 'video', 'image')),
  created_at    timestamptz not null default now()
);

alter table public.categories add column if not exists subtitle text not null default 'Таньж таа';
alter table public.categories add column if not exists accent text not null default '#22d3ee';
alter table public.categories add column if not exists picker_label text not null default 'Багц';
alter table public.categories add column if not exists item_label text not null default 'асуулт';
alter table public.categories add column if not exists empty_message text not null default 'Багц алга байна.';
alter table public.categories add column if not exists display_order integer not null default 0;
alter table public.categories add column if not exists is_active boolean not null default true;
alter table public.categories add column if not exists media_type text;
alter table public.categories add column if not exists created_at timestamptz not null default now();

alter table public.categories drop constraint if exists categories_media_type_check;
alter table public.categories
  add constraint categories_media_type_check
  check (media_type in ('audio', 'video', 'image'));

insert into public.categories (
  slug, name, icon, subtitle, accent, picker_label, item_label, empty_message, display_order, media_type
)
values
  ('song', 'Дуу', '🎵', 'Дууг сонсоод таа', '#ec4899', 'Уран бүтээлч', 'дуу', 'Уран бүтээлч алга байна.', 10, 'audio'),
  ('cartoon', 'Хүүхэлдэйн кино', '📺', 'Дуугаар нь таа', '#22d3ee', 'Цуврал', 'кино', 'Цуврал алга байна.', 20, 'audio'),
  ('movie', 'Кино', '🎬', 'Хэсгээр нь таа', '#a855f7', 'Цуглуулга', 'кино', 'Кино алга байна.', 30, 'video'),
  ('actor', 'Жүжигчин', '⭐', 'Нэрийг нь таа', '#6366f1', 'Цуглуулга', 'хүн', 'Жүжигчин алга байна.', 40, 'image')
on conflict (slug) do nothing;

alter table public.artists drop constraint if exists artists_category_check;
alter table public.artists drop constraint if exists artists_category_fkey;
alter table public.artists
  add constraint artists_category_fkey
  foreign key (category) references public.categories (slug);

alter table public.scores drop constraint if exists scores_category_check;
alter table public.scores drop constraint if exists scores_category_fkey;
alter table public.scores
  add constraint scores_category_fkey
  foreign key (category) references public.categories (slug);

-- A category's configured media type is authoritative for every item in its packs.
create or replace function public.enforce_category_media_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_media_type text;
begin
  select category.media_type into expected_media_type
  from public.artists as artist
  join public.categories as category on category.slug = artist.category
  where artist.id = new.artist_id;

  if expected_media_type is not null and new.media_type <> expected_media_type then
    raise exception 'Media type % does not match the category media type %', new.media_type, expected_media_type;
  end if;

  return new;
end;
$$;

drop trigger if exists songs_enforce_category_media_type on public.songs;
create trigger songs_enforce_category_media_type
  before insert or update of artist_id, media_type on public.songs
  for each row execute function public.enforce_category_media_type();

do $$
begin
  if exists (
    select 1
    from public.songs as song
    join public.artists as artist on artist.id = song.artist_id
    join public.categories as category on category.slug = artist.category
    where category.media_type is not null and song.media_type <> category.media_type
  ) then
    raise exception 'Existing song media types do not match their category configuration';
  end if;
end;
$$;

alter table public.categories enable row level security;

drop policy if exists "categories are readable by everyone" on public.categories;
create policy "categories are readable by everyone"
  on public.categories for select
  using (true);

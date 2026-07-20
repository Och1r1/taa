-- Таа — category-specific leaderboards
-- Run this after leaderboard.sql and media.sql for an existing project.
-- It classifies historical scores from their pack's current category.

alter table public.scores
  add column if not exists category text;

update public.scores as score
set category = coalesce(
  (select artist.category from public.artists as artist where artist.slug = score.artist_slug),
  'song'
)
where score.category is null;

alter table public.scores
  alter column category set default 'song',
  alter column category set not null;

alter table public.scores drop constraint if exists scores_category_check;
alter table public.scores
  add constraint scores_category_check
  check (category in ('song', 'cartoon', 'movie', 'actor'));

create index if not exists scores_category_points_idx
  on public.scores (category, points desc, created_at asc);

-- The client submits a category for display, but the database makes the pack's
-- category authoritative so anonymous users cannot place a score on another board.
create or replace function public.assign_score_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select artist.category into new.category
  from public.artists as artist
  where artist.slug = new.artist_slug;

  if new.category is null then
    raise exception 'Unknown score pack: %', new.artist_slug;
  end if;

  return new;
end;
$$;

drop trigger if exists scores_assign_category on public.scores;
create trigger scores_assign_category
  before insert on public.scores
  for each row execute function public.assign_score_category();

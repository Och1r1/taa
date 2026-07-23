-- Optional server-side foundation for the daily challenge and cross-device progress.
-- Apply after schema.sql, media.sql, and rooms-profiles.sql.

create table if not exists public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_date date not null,
  artist_slug text not null references public.artists(slug) on delete cascade,
  category text not null,
  seed text not null,
  rounds integer not null default 5 check (rounds between 3 and 20),
  created_at timestamptz not null default now(),
  unique (challenge_date, artist_slug)
);

create table if not exists public.daily_challenge_completions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points >= 0),
  correct_count integer not null check (correct_count >= 0),
  completed_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create index if not exists daily_challenges_date_idx
  on public.daily_challenges (challenge_date desc, category);
create index if not exists daily_challenge_completions_rank_idx
  on public.daily_challenge_completions (challenge_id, points desc, completed_at asc);

alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_completions enable row level security;

drop policy if exists "daily challenges are readable" on public.daily_challenges;
create policy "daily challenges are readable"
  on public.daily_challenges for select using (true);

drop policy if exists "daily completions are readable" on public.daily_challenge_completions;
create policy "daily completions are readable"
  on public.daily_challenge_completions for select using (true);

drop policy if exists "players insert own daily completion" on public.daily_challenge_completions;
create policy "players insert own daily completion"
  on public.daily_challenge_completions for insert
  with check (auth.uid() = user_id);

-- One deterministic challenge per date and content pack. The function means no
-- scheduled job is required before the first player opens that day's challenge.
create or replace function public.get_or_create_daily_challenge(
  p_challenge_date date,
  p_artist_slug text,
  p_category text
)
returns public.daily_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.daily_challenges;
begin
  if p_challenge_date is null or p_challenge_date > current_date + 1 or p_challenge_date < current_date - 1 then
    raise exception 'Invalid challenge date';
  end if;

  if not exists (
    select 1 from public.artists where slug = p_artist_slug and category = p_category
  ) then
    raise exception 'Invalid challenge pack';
  end if;

  insert into public.daily_challenges (challenge_date, artist_slug, category, seed, rounds)
  values (
    p_challenge_date,
    p_artist_slug,
    p_category,
    'taa-daily:' || p_challenge_date::text || ':' || p_artist_slug,
    5
  )
  on conflict (challenge_date, artist_slug) do update set artist_slug = excluded.artist_slug
  returning * into v_challenge;

  return v_challenge;
end;
$$;

create or replace function public.complete_daily_challenge(
  p_challenge_id uuid,
  p_points integer,
  p_correct_count integer
)
returns public.daily_challenge_completions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion public.daily_challenge_completions;
  v_rounds integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select rounds into v_rounds from public.daily_challenges where id = p_challenge_id;
  if v_rounds is null then raise exception 'Challenge not found'; end if;
  if p_points < 0 or p_points > v_rounds * 1000 or p_correct_count < 0 or p_correct_count > v_rounds then
    raise exception 'Invalid result';
  end if;

  insert into public.daily_challenge_completions (challenge_id, user_id, points, correct_count)
  values (p_challenge_id, auth.uid(), p_points, p_correct_count)
  on conflict (challenge_id, user_id) do update
    set points = greatest(public.daily_challenge_completions.points, excluded.points),
        correct_count = greatest(public.daily_challenge_completions.correct_count, excluded.correct_count),
        completed_at = now()
  returning * into v_completion;
  return v_completion;
end;
$$;

create or replace function public.list_daily_challenge_leaderboard(
  p_challenge_id uuid,
  p_limit integer default 10
)
returns table (player_name text, points integer, correct_count integer, completed_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select coalesce(p.display_name, 'Тоглогч'), c.points, c.correct_count, c.completed_at
  from public.daily_challenge_completions c
  left join public.profiles p on p.id = c.user_id
  where c.challenge_id = p_challenge_id
  order by c.points desc, c.correct_count desc, c.completed_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.get_or_create_daily_challenge(date, text, text) from public;
grant execute on function public.get_or_create_daily_challenge(date, text, text) to anon, authenticated;
revoke all on function public.complete_daily_challenge(uuid, integer, integer) from public;
grant execute on function public.complete_daily_challenge(uuid, integer, integer) to anon, authenticated;
revoke all on function public.list_daily_challenge_leaderboard(uuid, integer) from public;
grant execute on function public.list_daily_challenge_leaderboard(uuid, integer) to anon, authenticated;

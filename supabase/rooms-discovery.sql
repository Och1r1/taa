-- Public lobby discovery (public rooms in lobby only; never private).
-- Apply after rooms-rate-limits.sql (uses assert_rate_limit when present).

create or replace function public.list_public_lobbies(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if exists (
    select 1 from pg_proc
    where proname = 'assert_rate_limit'
      and pronamespace = 'public'::regnamespace
  ) then
    perform public.assert_rate_limit('list_lobbies', 30, 60);
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(row) order by row.created_at desc)
      from (
        select
          r.id,
          r.pin,
          r.artist_slug,
          r.category,
          r.rounds,
          r.time_per_round,
          r.created_at,
          (
            select count(*)::integer
            from public.room_players as p
            where p.room_id = r.id
              and coalesce(p.role, 'player') = 'player'
          ) as player_count
        from public.rooms as r
        where r.visibility = 'public'
          and r.status = 'lobby'
          and r.expires_at > now()
        order by r.created_at desc
        limit v_limit
      ) as row
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_public_lobbies(integer) from public;
grant execute on function public.list_public_lobbies(integer) to anon, authenticated;

notify pgrst, 'reload schema';

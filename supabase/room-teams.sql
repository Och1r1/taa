-- Optional two-team event mode. Apply after rooms-rls-auth-host.sql.
alter table public.room_players add column if not exists team smallint;
alter table public.room_players drop constraint if exists room_players_team_check;
alter table public.room_players add constraint room_players_team_check check (team in (1, 2));

create or replace function public.assign_room_team(p_room_id uuid, p_player_id uuid, p_team smallint)
returns public.room_players language plpgsql security definer set search_path = public as $$
declare v_player public.room_players;
begin
  perform public.assert_host(p_room_id);
  if p_team not in (1, 2) then raise exception 'Invalid team'; end if;
  update public.room_players set team = p_team where id = p_player_id and room_id = p_room_id returning * into v_player;
  if not found then raise exception 'Player not in room'; end if;
  return v_player;
end; $$;
revoke all on function public.assign_room_team(uuid, uuid, smallint) from public;
grant execute on function public.assign_room_team(uuid, uuid, smallint) to anon, authenticated;

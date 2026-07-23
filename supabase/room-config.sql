-- Таа — host-editable lobby settings
-- Run after supabase/rooms-rls-auth-host.sql.

create or replace function public.update_room_config(
  p_room_id uuid,
  p_rounds integer,
  p_time_per_round integer
)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  perform public.assert_host(p_room_id);

  if p_rounds not in (3, 5, 10, 15) then
    raise exception 'Invalid round count';
  end if;
  if p_time_per_round not in (10, 15, 20, 30, 45) then
    raise exception 'Invalid time per round';
  end if;

  update public.rooms
  set rounds = p_rounds,
      time_per_round = p_time_per_round
  where id = p_room_id
    and status = 'lobby'
  returning * into v_room;

  if not found then
    raise exception 'Room can only be configured in the lobby';
  end if;
  return v_room;
end;
$$;

revoke all on function public.update_room_config(uuid, integer, integer) from public;
grant execute on function public.update_room_config(uuid, integer, integer) to anon, authenticated;

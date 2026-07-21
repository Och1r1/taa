-- Таа — multiplayer polish (Хамтдаа), Phase 3
-- Run AFTER rooms-game.sql.
-- Heartbeat / last_seen, host kick, idle prune, pre-round countdown.

alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms
  add constraint rooms_status_check
  check (status in ('lobby', 'countdown', 'playing', 'revealing', 'finished', 'closed'));

alter table public.rooms
  add column if not exists countdown_ends_at timestamptz;

-- Keep start_room_round accepting countdown → playing transitions.
create or replace function public.start_room_round(
  p_room_id uuid,
  p_host_token text,
  p_round_index integer,
  p_answer_song_id uuid,
  p_answer_title text,
  p_options jsonb,
  p_media_type text,
  p_media_path text,
  p_snippet_start double precision default 0,
  p_snippet_duration double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.room_rounds;
  v_ends_at timestamptz;
begin
  perform public.assert_host(p_room_id, p_host_token);

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status in ('closed', 'finished') then
    raise exception 'Room is closed';
  end if;
  if v_room.expires_at <= now() then
    update public.rooms set status = 'closed' where id = p_room_id;
    raise exception 'Room has expired';
  end if;
  if p_round_index < 0 or p_round_index >= v_room.rounds then
    raise exception 'Invalid round index';
  end if;

  if v_room.status = 'countdown' then
    -- Next round index equals how many rounds already exist (0 on first start).
    if p_round_index <> (select count(*)::integer from public.room_rounds where room_id = p_room_id) then
      raise exception 'Unexpected round index';
    end if;
  elsif v_room.status = 'lobby' then
    if p_round_index <> 0 then
      raise exception 'Unexpected round index';
    end if;
  else
    raise exception 'Cannot start round now';
  end if;

  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 2 then
    raise exception 'Options required';
  end if;
  if p_media_type not in ('audio', 'video', 'image') then
    raise exception 'Invalid media type';
  end if;

  update public.room_rounds
  set status = 'revealed'
  where room_id = p_room_id and status = 'active';

  v_ends_at := now() + make_interval(secs => v_room.time_per_round);

  insert into public.room_rounds (
    room_id, round_index, answer_song_id, answer_title, options,
    media_type, media_path, snippet_start, snippet_duration,
    status, started_at, ends_at
  )
  values (
    p_room_id, p_round_index, p_answer_song_id, p_answer_title, p_options,
    p_media_type, p_media_path, coalesce(p_snippet_start, 0), coalesce(p_snippet_duration, 15),
    'active', now(), v_ends_at
  )
  returning * into v_round;

  update public.rooms
  set status = 'playing',
      current_round_index = p_round_index,
      countdown_ends_at = null
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'round', to_jsonb(v_round)
  );
end;
$$;

-- Host starts a short synced countdown before the next (or first) round.
create or replace function public.begin_room_countdown(
  p_room_id uuid,
  p_host_token text,
  p_seconds integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_secs integer := greatest(1, least(coalesce(p_seconds, 3), 10));
begin
  perform public.assert_host(p_room_id, p_host_token);

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status not in ('lobby', 'revealing') then
    raise exception 'Cannot start countdown now';
  end if;
  if v_room.status = 'lobby' and (
    select count(*) from public.room_players where room_id = p_room_id
  ) < 2 then
    raise exception 'At least two players are required';
  end if;

  update public.rooms
  set status = 'countdown',
      countdown_ends_at = now() + make_interval(secs => v_secs)
  where id = p_room_id
  returning * into v_room;

  return to_jsonb(v_room);
end;
$$;

create or replace function public.heartbeat_room_player(
  p_room_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.room_players
  set last_seen = now()
  where id = p_player_id and room_id = p_room_id;

  if not found then
    raise exception 'Player not in room';
  end if;
end;
$$;

-- Host removes one non-host player (lobby or mid-game).
create or replace function public.kick_room_player(
  p_room_id uuid,
  p_host_token text,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.room_players;
begin
  perform public.assert_host(p_room_id, p_host_token);

  select * into v_player
  from public.room_players
  where id = p_player_id and room_id = p_room_id;

  if not found then
    return;
  end if;
  if v_player.is_host then
    raise exception 'Cannot kick the host';
  end if;

  delete from public.room_answers where player_id = p_player_id;
  delete from public.room_players where id = p_player_id;
end;
$$;

-- Host drops guests who stopped heartbeating (default 90s).
create or replace function public.prune_idle_room_players(
  p_room_id uuid,
  p_host_token text,
  p_idle_seconds integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idle integer := greatest(30, least(coalesce(p_idle_seconds, 90), 600));
  v_count integer;
begin
  perform public.assert_host(p_room_id, p_host_token);

  with removed as (
    delete from public.room_players as p
    where p.room_id = p_room_id
      and p.is_host = false
      and p.last_seen < now() - make_interval(secs => v_idle)
    returning p.id
  )
  select count(*) into v_count from removed;

  delete from public.room_answers as a
  where a.room_id = p_room_id
    and not exists (
      select 1 from public.room_players as p where p.id = a.player_id
    );

  return coalesce(v_count, 0);
end;
$$;

-- Host resets a finished room for a rematch with the same players.
create or replace function public.restart_room_game(
  p_room_id uuid,
  p_host_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  perform public.assert_host(p_room_id, p_host_token);

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'finished' then raise exception 'Game is not finished'; end if;

  delete from public.room_answers where room_id = p_room_id;
  delete from public.room_rounds where room_id = p_room_id;
  update public.room_players
  set score = 0,
      correct_count = 0
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby',
      current_round_index = 0,
      countdown_ends_at = null
  where id = p_room_id
  returning * into v_room;

  return to_jsonb(v_room);
end;
$$;

grant execute on function public.start_room_round(uuid, text, integer, uuid, text, jsonb, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.begin_room_countdown(uuid, text, integer) to anon, authenticated;
grant execute on function public.heartbeat_room_player(uuid, uuid) to anon, authenticated;
grant execute on function public.kick_room_player(uuid, text, uuid) to anon, authenticated;
grant execute on function public.prune_idle_room_players(uuid, text, integer) to anon, authenticated;
grant execute on function public.restart_room_game(uuid, text) to anon, authenticated;

-- Make the new RPC visible to Supabase PostgREST immediately.
notify pgrst, 'reload schema';

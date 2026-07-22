-- Таа — authenticated multiplayer membership, Phase 4 steps 1–3.
-- Run AFTER rooms-polish.sql, after enabling Supabase Anonymous Sign-Ins.
-- Existing pre-auth room rows remain readable during the RLS migration, but cannot
-- perform player actions because they have no authenticated owner.

alter table public.room_players
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists room_players_room_user_idx
  on public.room_players (room_id, user_id)
  where user_id is not null;

-- Create rooms only for the authenticated caller, and bind the host seat to them.
create or replace function public.create_room(
  p_pin text,
  p_host_token text,
  p_host_nickname text,
  p_artist_slug text,
  p_category text,
  p_rounds integer,
  p_time_per_round integer,
  p_max_points integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_player public.room_players;
  v_nickname text := trim(p_host_nickname);
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN must be 6 digits'; end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 24 then
    raise exception 'Nickname must be 1–24 characters';
  end if;
  if char_length(p_host_token) < 16 then raise exception 'Invalid host token'; end if;

  insert into public.rooms (pin, artist_slug, category, rounds, time_per_round, max_points)
  values (p_pin, p_artist_slug, p_category, p_rounds, p_time_per_round, p_max_points)
  returning * into v_room;

  insert into public.room_host_secrets (room_id, host_token)
  values (v_room.id, p_host_token);

  insert into public.room_players (room_id, user_id, nickname, is_host)
  values (v_room.id, v_user_id, v_nickname, true)
  returning * into v_player;

  update public.rooms set host_player_id = v_player.id where id = v_room.id returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'player', to_jsonb(v_player),
    'host_token', p_host_token
  );
end;
$$;

-- A user has one seat per room. Retrying a join returns that seat rather than creating another.
create or replace function public.join_room(p_pin text, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_player public.room_players;
  v_nickname text := trim(p_nickname);
  v_user_id uuid := auth.uid();
  v_count integer;
  v_max_players constant integer := 20;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN must be 6 digits'; end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 24 then
    raise exception 'Nickname must be 1–24 characters';
  end if;

  select * into v_room from public.rooms where pin = p_pin for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'lobby' then raise exception 'Room is not accepting players'; end if;
  if v_room.expires_at <= now() then
    update public.rooms set status = 'closed' where id = v_room.id;
    raise exception 'Room has expired';
  end if;

  select * into v_player
  from public.room_players
  where room_id = v_room.id and user_id = v_user_id;
  if found then
    return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
  end if;

  select count(*) into v_count from public.room_players where room_id = v_room.id;
  if v_count >= v_max_players then raise exception 'Room is full'; end if;
  if exists (
    select 1 from public.room_players
    where room_id = v_room.id and lower(nickname) = lower(v_nickname)
  ) then
    raise exception 'Nickname already taken';
  end if;

  insert into public.room_players (room_id, user_id, nickname, is_host)
  values (v_room.id, v_user_id, v_nickname, false)
  returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
end;
$$;

-- Player actions derive the caller's seat from auth.uid(); p_player_id remains in
-- the legacy RPC signatures only so existing clients receive a safe upgrade.
create or replace function public.submit_room_answer(
  p_room_id uuid,
  p_player_id uuid,
  p_round_index integer,
  p_picked_song_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.room_rounds;
  v_player public.room_players;
  v_correct boolean;
  v_time_left double precision;
  v_points integer;
  v_outcome text;
  v_answer public.room_answers;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'playing' then raise exception 'Round is not active'; end if;

  select * into v_player from public.room_players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then raise exception 'Player not in room'; end if;

  select * into v_round from public.room_rounds
  where room_id = p_room_id and round_index = p_round_index for update;
  if not found then raise exception 'Round not found'; end if;
  if v_round.status <> 'active' then raise exception 'Round is not active'; end if;
  if now() > v_round.ends_at then raise exception 'Time is up'; end if;
  if exists (
    select 1 from public.room_answers
    where room_id = p_room_id and round_index = p_round_index and player_id = v_player.id
  ) then raise exception 'Already answered'; end if;

  v_correct := (p_picked_song_id = v_round.answer_song_id);
  v_time_left := extract(epoch from (v_round.ends_at - now()));
  v_points := public.compute_round_points(
    v_correct, v_time_left, v_room.time_per_round::double precision, v_room.max_points
  );
  v_outcome := case when v_correct then 'correct' else 'wrong' end;

  insert into public.room_answers (
    room_id, round_index, player_id, picked_song_id, answered_at, points, outcome
  )
  values (p_room_id, p_round_index, v_player.id, p_picked_song_id, now(), v_points, v_outcome)
  returning * into v_answer;

  return to_jsonb(v_answer);
end;
$$;

create or replace function public.leave_room(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.room_players;
  v_remaining integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_player from public.room_players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then raise exception 'Player not in room'; end if;

  delete from public.room_players where id = v_player.id;
  if v_player.is_host then
    update public.rooms set status = 'closed', host_player_id = null where id = p_room_id;
    delete from public.room_players where room_id = p_room_id;
    delete from public.room_host_secrets where room_id = p_room_id;
    return;
  end if;

  select count(*) into v_remaining from public.room_players where room_id = p_room_id;
  if v_remaining = 0 then
    update public.rooms set status = 'closed' where id = p_room_id;
    delete from public.room_host_secrets where room_id = p_room_id;
  end if;
end;
$$;

create or replace function public.heartbeat_room_player(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.room_players set last_seen = now()
  where room_id = p_room_id and user_id = auth.uid();
  if not found then raise exception 'Player not in room'; end if;
end;
$$;

-- Таа — private rooms + spectators, Phase 4 remaining core.
-- Run AFTER rooms-leaderboard.sql (and rooms-auth.sql).
-- Private rooms: invite-link only. Spectators: read-only seats, mid-game join OK.

-- ── rooms: visibility + invite ──────────────────────────────────────────────
alter table public.rooms
  add column if not exists visibility text;

update public.rooms
set visibility = 'public'
where visibility is null;

alter table public.rooms
  alter column visibility set default 'public',
  alter column visibility set not null;

alter table public.rooms drop constraint if exists rooms_visibility_check;
alter table public.rooms
  add constraint rooms_visibility_check check (visibility in ('public', 'private'));

-- Invite secrets stay off public SELECT (same pattern as host tokens).
create table if not exists public.room_invite_secrets (
  room_id       uuid primary key references public.rooms (id) on delete cascade,
  invite_secret text not null unique check (char_length(invite_secret) >= 16)
);

alter table public.room_invite_secrets enable row level security;

-- If an earlier draft put invite_secret on rooms, drop it so it cannot leak via SELECT.
alter table public.rooms drop column if exists invite_secret;

-- ── room_players: role ──────────────────────────────────────────────────────
alter table public.room_players
  add column if not exists role text;

update public.room_players
set role = 'player'
where role is null;

alter table public.room_players
  alter column role set default 'player',
  alter column role set not null;

alter table public.room_players drop constraint if exists room_players_role_check;
alter table public.room_players
  add constraint room_players_role_check check (role in ('player', 'spectator'));

create index if not exists room_players_room_role_idx
  on public.room_players (room_id, role);

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.generate_room_invite_secret()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create or replace function public.assert_room_invite(
  p_room public.rooms,
  p_invite text
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if p_room.visibility = 'private' then
    if p_invite is null or char_length(trim(p_invite)) < 16 then
      raise exception 'Private room requires invite';
    end if;
    select invite_secret into v_secret
    from public.room_invite_secrets
    where room_id = p_room.id;
    if v_secret is distinct from trim(p_invite) then
      raise exception 'Invalid invite';
    end if;
  end if;
end;
$$;

-- ── create_room (visibility + invite) ───────────────────────────────────────
create or replace function public.create_room(
  p_pin text,
  p_host_token text,
  p_host_nickname text,
  p_artist_slug text,
  p_category text,
  p_rounds integer,
  p_time_per_round integer,
  p_max_points integer default 1000,
  p_visibility text default 'public'
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
  v_visibility text := lower(coalesce(nullif(trim(p_visibility), ''), 'public'));
  v_invite text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN must be 6 digits'; end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 24 then
    raise exception 'Nickname must be 1–24 characters';
  end if;
  if char_length(p_host_token) < 16 then raise exception 'Invalid host token'; end if;
  if v_visibility not in ('public', 'private') then
    raise exception 'Invalid visibility';
  end if;

  v_invite := case
    when v_visibility = 'private' then public.generate_room_invite_secret()
    else null
  end;

  insert into public.rooms (
    pin, artist_slug, category, rounds, time_per_round, max_points, visibility
  )
  values (
    p_pin, p_artist_slug, p_category, p_rounds, p_time_per_round, p_max_points, v_visibility
  )
  returning * into v_room;

  insert into public.room_host_secrets (room_id, host_token)
  values (v_room.id, p_host_token);

  if v_invite is not null then
    insert into public.room_invite_secrets (room_id, invite_secret)
    values (v_room.id, v_invite);
  end if;

  insert into public.room_players (room_id, user_id, nickname, is_host, role)
  values (v_room.id, v_user_id, v_nickname, true, 'player')
  returning * into v_player;

  update public.rooms set host_player_id = v_player.id where id = v_room.id returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'player', to_jsonb(v_player),
    'host_token', p_host_token,
    'invite_secret', v_invite
  );
end;
$$;

-- ── join as player (lobby only; private needs invite) ───────────────────────
create or replace function public.join_room(
  p_pin text,
  p_nickname text,
  p_invite text default null
)
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
  perform public.assert_room_invite(v_room, p_invite);
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

  select count(*) into v_count
  from public.room_players
  where room_id = v_room.id and role = 'player';
  if v_count >= v_max_players then raise exception 'Room is full'; end if;
  if exists (
    select 1 from public.room_players
    where room_id = v_room.id and lower(nickname) = lower(v_nickname)
  ) then
    raise exception 'Nickname already taken';
  end if;

  insert into public.room_players (room_id, user_id, nickname, is_host, role)
  values (v_room.id, v_user_id, v_nickname, false, 'player')
  returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
end;
$$;

-- Join via invite secret (private deep links without typing PIN).
create or replace function public.join_room_by_invite(
  p_invite text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_invite text := trim(p_invite);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(v_invite) < 16 then raise exception 'Invalid invite'; end if;

  select r.* into v_room
  from public.rooms as r
  join public.room_invite_secrets as s on s.room_id = r.id
  where s.invite_secret = v_invite;
  if not found then raise exception 'Invalid invite'; end if;

  return public.join_room(v_room.pin, p_nickname, v_invite);
end;
$$;

-- ── join as spectator (lobby or live; private needs invite) ─────────────────
create or replace function public.join_room_spectator(
  p_pin text,
  p_nickname text,
  p_invite text default null
)
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
  v_max_spectators constant integer := 20;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN must be 6 digits'; end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 24 then
    raise exception 'Nickname must be 1–24 characters';
  end if;

  select * into v_room from public.rooms where pin = p_pin for update;
  if not found then raise exception 'Room not found'; end if;
  perform public.assert_room_invite(v_room, p_invite);
  if v_room.status in ('finished', 'closed') then
    raise exception 'Room is not accepting spectators';
  end if;
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

  select count(*) into v_count
  from public.room_players
  where room_id = v_room.id and role = 'spectator';
  if v_count >= v_max_spectators then raise exception 'Spectator limit reached'; end if;
  if exists (
    select 1 from public.room_players
    where room_id = v_room.id and lower(nickname) = lower(v_nickname)
  ) then
    raise exception 'Nickname already taken';
  end if;

  insert into public.room_players (room_id, user_id, nickname, is_host, role)
  values (v_room.id, v_user_id, v_nickname, false, 'spectator')
  returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
end;
$$;

create or replace function public.join_room_spectator_by_invite(
  p_invite text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_invite text := trim(p_invite);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(v_invite) < 16 then raise exception 'Invalid invite'; end if;

  select r.* into v_room
  from public.rooms as r
  join public.room_invite_secrets as s on s.room_id = r.id
  where s.invite_secret = v_invite;
  if not found then raise exception 'Invalid invite'; end if;

  return public.join_room_spectator(v_room.pin, p_nickname, v_invite);
end;
$$;

-- Host rotates private invite (old links stop working).
create or replace function public.rotate_room_invite(
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
  v_invite text := public.generate_room_invite_secret();
begin
  perform public.assert_host(p_room_id, p_host_token);

  update public.rooms
  set visibility = 'private'
  where id = p_room_id
    and status <> 'closed'
  returning * into v_room;

  if not found then raise exception 'Room not found'; end if;

  insert into public.room_invite_secrets (room_id, invite_secret)
  values (p_room_id, v_invite)
  on conflict (room_id) do update set invite_secret = excluded.invite_secret;

  return jsonb_build_object('room', to_jsonb(v_room), 'invite_secret', v_invite);
end;
$$;

-- Peek room status for join UI (PIN). Private rooms still require later invite on join.
create or replace function public.peek_room_by_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN must be 6 digits'; end if;
  select * into v_room from public.rooms where pin = p_pin;
  if not found then raise exception 'Room not found'; end if;
  return jsonb_build_object(
    'pin', v_room.pin,
    'status', v_room.status,
    'visibility', v_room.visibility,
    'accepts_players', v_room.status = 'lobby',
    'accepts_spectators', v_room.status not in ('finished', 'closed')
  );
end;
$$;

create or replace function public.peek_room_by_invite(p_invite text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_invite text := trim(p_invite);
begin
  if char_length(v_invite) < 16 then raise exception 'Invalid invite'; end if;
  select r.* into v_room
  from public.rooms as r
  join public.room_invite_secrets as s on s.room_id = r.id
  where s.invite_secret = v_invite;
  if not found then raise exception 'Invalid invite'; end if;
  return jsonb_build_object(
    'pin', v_room.pin,
    'status', v_room.status,
    'visibility', v_room.visibility,
    'invite_secret', v_invite,
    'accepts_players', v_room.status = 'lobby',
    'accepts_spectators', v_room.status not in ('finished', 'closed')
  );
end;
$$;

-- Spectators cannot answer.
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
  if v_player.role = 'spectator' then raise exception 'Spectators cannot answer'; end if;

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

-- Export only players (not spectators) on finish — keep rooms-leaderboard finish body,
-- but filter role = player when inserting.
create or replace function public.finish_room_game(
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
  v_export_id uuid;
  v_inserted integer := 0;
begin
  perform public.assert_host(p_room_id, p_host_token);

  update public.rooms
  set status = 'finished'
  where id = p_room_id
    and status in ('revealing', 'playing', 'lobby')
  returning * into v_room;

  if not found then
    select * into v_room from public.rooms where id = p_room_id;
    if not found then raise exception 'Room not found'; end if;
  end if;

  if v_room.score_export_id is not null then
    return jsonb_build_object('room', to_jsonb(v_room), 'scores_saved', 0, 'already_saved', true);
  end if;

  v_export_id := gen_random_uuid();

  update public.rooms
  set score_export_id = v_export_id
  where id = p_room_id
    and score_export_id is null
  returning * into v_room;

  if not found then
    select * into v_room from public.rooms where id = p_room_id;
    return jsonb_build_object('room', to_jsonb(v_room), 'scores_saved', 0, 'already_saved', true);
  end if;

  insert into public.scores (
    player_name,
    artist_slug,
    category,
    points,
    correct_count,
    rounds,
    mode,
    room_id,
    room_player_id,
    user_id,
    score_export_id
  )
  select
    left(p.nickname, 24),
    v_room.artist_slug,
    v_room.category,
    p.score,
    p.correct_count,
    v_room.rounds,
    'multi',
    v_room.id,
    p.id,
    p.user_id,
    v_export_id
  from public.room_players as p
  where p.room_id = p_room_id
    and p.role = 'player';

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'scores_saved', v_inserted,
    'already_saved', false
  );
end;
$$;

grant execute on function public.create_room(text, text, text, text, text, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.join_room(text, text, text) to anon, authenticated;
grant execute on function public.join_room_by_invite(text, text) to anon, authenticated;
grant execute on function public.join_room_spectator(text, text, text) to anon, authenticated;
grant execute on function public.join_room_spectator_by_invite(text, text) to anon, authenticated;
grant execute on function public.rotate_room_invite(uuid, text) to anon, authenticated;
grant execute on function public.peek_room_by_pin(text) to anon, authenticated;
grant execute on function public.peek_room_by_invite(text) to anon, authenticated;
grant execute on function public.submit_room_answer(uuid, uuid, integer, uuid) to anon, authenticated;
grant execute on function public.finish_room_game(uuid, text) to anon, authenticated;

-- Keep legacy create_room(… 8 args) callable by regenerating with default visibility via overload:
-- PostgREST may still call the 8-arg form; provide a thin wrapper.
create or replace function public.create_room(
  p_pin text,
  p_host_token text,
  p_host_nickname text,
  p_artist_slug text,
  p_category text,
  p_rounds integer,
  p_time_per_round integer,
  p_max_points integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_room(
    p_pin, p_host_token, p_host_nickname, p_artist_slug, p_category,
    p_rounds, p_time_per_round, p_max_points, 'public'
  );
end;
$$;

grant execute on function public.create_room(text, text, text, text, text, integer, integer, integer) to anon, authenticated;

-- Legacy 2-arg join (public PIN only).
create or replace function public.join_room(p_pin text, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.join_room(p_pin, p_nickname, null);
end;
$$;

grant execute on function public.join_room(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

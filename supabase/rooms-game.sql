-- Таа — multiplayer synced rounds (Хамтдаа), Phase 2
-- Run AFTER rooms.sql.
-- Adds room_rounds / room_answers and host-driven start / answer / reveal / finish RPCs.

create table if not exists public.room_rounds (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.rooms (id) on delete cascade,
  round_index        integer not null check (round_index >= 0),
  answer_song_id     uuid not null,
  answer_title       text not null,
  options            jsonb not null,
  media_type         text not null check (media_type in ('audio', 'video', 'image')),
  media_path         text not null,
  snippet_start      double precision not null default 0,
  snippet_duration   double precision not null default 15,
  status             text not null default 'active'
                       check (status in ('active', 'revealed')),
  started_at         timestamptz not null default now(),
  ends_at            timestamptz not null,
  unique (room_id, round_index)
);

create index if not exists room_rounds_room_id_idx on public.room_rounds (room_id);

create table if not exists public.room_answers (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  round_index     integer not null check (round_index >= 0),
  player_id       uuid not null references public.room_players (id) on delete cascade,
  picked_song_id  uuid,
  answered_at     timestamptz not null default now(),
  points          integer not null default 0 check (points >= 0),
  outcome         text not null check (outcome in ('correct', 'wrong', 'timeout', 'skipped')),
  unique (room_id, round_index, player_id)
);

create index if not exists room_answers_round_idx
  on public.room_answers (room_id, round_index);

alter table public.room_rounds enable row level security;
alter table public.room_answers enable row level security;

drop policy if exists "room rounds are readable by everyone" on public.room_rounds;
create policy "room rounds are readable by everyone"
  on public.room_rounds for select
  using (true);

drop policy if exists "room answers are readable by everyone" on public.room_answers;
create policy "room answers are readable by everyone"
  on public.room_answers for select
  using (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.room_rounds;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.room_answers;
  exception
    when duplicate_object then null;
  end;
end;
$$;

-- Kahoot-style points (mirrors src/game/scoring.ts).
create or replace function public.compute_round_points(
  p_correct boolean,
  p_time_left double precision,
  p_time_per_round double precision,
  p_max_points integer
)
returns integer
language sql
immutable
as $$
  select case
    when not p_correct then 0
    else round(
      p_max_points * (
        0.5 + 0.5 * greatest(0::double precision, least(1::double precision,
          p_time_left / nullif(p_time_per_round, 0)))
      )
    )::integer
  end;
$$;

create or replace function public.assert_host(p_room_id uuid, p_host_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.room_host_secrets
    where room_id = p_room_id and host_token = p_host_token
  ) then
    raise exception 'Not allowed';
  end if;
end;
$$;

-- Host starts (or advances to) a round. Builds shared deadline from room.time_per_round.
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
  if v_room.status = 'lobby' then
    if p_round_index <> 0 then
      raise exception 'Unexpected round index';
    end if;
  elsif v_room.status = 'revealing' then
    if p_round_index <> v_room.current_round_index + 1 then
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

  -- Closing any previously active round without scoring is host's responsibility
  -- (should reveal first). Force-mark leftovers revealed without score apply if needed.
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
      current_round_index = p_round_index
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'round', to_jsonb(v_round)
  );
end;
$$;

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
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'playing' then raise exception 'Round is not active'; end if;

  select * into v_player
  from public.room_players
  where id = p_player_id and room_id = p_room_id;
  if not found then raise exception 'Player not in room'; end if;

  select * into v_round
  from public.room_rounds
  where room_id = p_room_id and round_index = p_round_index
  for update;
  if not found then raise exception 'Round not found'; end if;
  if v_round.status <> 'active' then raise exception 'Round is not active'; end if;
  if now() > v_round.ends_at then raise exception 'Time is up'; end if;

  if exists (
    select 1 from public.room_answers
    where room_id = p_room_id and round_index = p_round_index and player_id = p_player_id
  ) then
    raise exception 'Already answered';
  end if;

  v_correct := (p_picked_song_id = v_round.answer_song_id);
  v_time_left := extract(epoch from (v_round.ends_at - now()));
  v_points := public.compute_round_points(
    v_correct, v_time_left, v_room.time_per_round::double precision, v_room.max_points
  );
  v_outcome := case when v_correct then 'correct' else 'wrong' end;

  insert into public.room_answers (
    room_id, round_index, player_id, picked_song_id, answered_at, points, outcome
  )
  values (
    p_room_id, p_round_index, p_player_id, p_picked_song_id, now(), v_points, v_outcome
  )
  returning * into v_answer;

  return to_jsonb(v_answer);
end;
$$;

create or replace function public.reveal_room_round(
  p_room_id uuid,
  p_host_token text,
  p_round_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.room_rounds;
  v_player record;
  v_answer record;
begin
  perform public.assert_host(p_room_id, p_host_token);

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;

  select * into v_round
  from public.room_rounds
  where room_id = p_room_id and round_index = p_round_index
  for update;
  if not found then raise exception 'Round not found'; end if;
  if v_round.status = 'revealed' then
    return jsonb_build_object('room', to_jsonb(v_room), 'round', to_jsonb(v_round));
  end if;

  -- Timeouts for anyone who did not answer.
  insert into public.room_answers (
    room_id, round_index, player_id, picked_song_id, answered_at, points, outcome
  )
  select
    p_room_id,
    p_round_index,
    p.id,
    null,
    now(),
    0,
    'timeout'
  from public.room_players as p
  where p.room_id = p_room_id
    and not exists (
      select 1 from public.room_answers as a
      where a.room_id = p_room_id
        and a.round_index = p_round_index
        and a.player_id = p.id
    );

  -- Apply this round's points to live scores (once).
  for v_answer in
    select * from public.room_answers
    where room_id = p_room_id and round_index = p_round_index
  loop
    update public.room_players
    set score = score + v_answer.points,
        correct_count = correct_count + case when v_answer.outcome = 'correct' then 1 else 0 end
    where id = v_answer.player_id;
  end loop;

  update public.room_rounds
  set status = 'revealed'
  where id = v_round.id
  returning * into v_round;

  update public.rooms
  set status = 'revealing'
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'round', to_jsonb(v_round)
  );
end;
$$;

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

  return to_jsonb(v_room);
end;
$$;

-- Keep close/leave cleanup for new tables (redefine Phase 1 helpers).
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
  select * into v_player
  from public.room_players
  where id = p_player_id and room_id = p_room_id;

  if not found then
    return;
  end if;

  delete from public.room_answers where player_id = p_player_id;
  delete from public.room_players where id = p_player_id;

  if v_player.is_host then
    update public.rooms set status = 'closed', host_player_id = null
    where id = p_room_id;
    delete from public.room_answers where room_id = p_room_id;
    delete from public.room_rounds where room_id = p_room_id;
    delete from public.room_players where room_id = p_room_id;
    delete from public.room_host_secrets where room_id = p_room_id;
    return;
  end if;

  select count(*) into v_remaining from public.room_players where room_id = p_room_id;
  if v_remaining = 0 then
    update public.rooms set status = 'closed' where id = p_room_id;
    delete from public.room_answers where room_id = p_room_id;
    delete from public.room_rounds where room_id = p_room_id;
    delete from public.room_host_secrets where room_id = p_room_id;
  end if;
end;
$$;

create or replace function public.close_room(p_room_id uuid, p_host_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.room_host_secrets
    where room_id = p_room_id and host_token = p_host_token
  ) then
    raise exception 'Not allowed to close this room';
  end if;

  update public.rooms set status = 'closed' where id = p_room_id;
  delete from public.room_answers where room_id = p_room_id;
  delete from public.room_rounds where room_id = p_room_id;
  delete from public.room_players where room_id = p_room_id;
  delete from public.room_host_secrets where room_id = p_room_id;
end;
$$;

grant execute on function public.compute_round_points(boolean, double precision, double precision, integer) to anon, authenticated;
grant execute on function public.assert_host(uuid, text) to anon, authenticated;
grant execute on function public.start_room_round(uuid, text, integer, uuid, text, jsonb, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.submit_room_answer(uuid, uuid, integer, uuid) to anon, authenticated;
grant execute on function public.reveal_room_round(uuid, text, integer) to anon, authenticated;
grant execute on function public.finish_room_game(uuid, text) to anon, authenticated;
grant execute on function public.leave_room(uuid, uuid) to anon, authenticated;
grant execute on function public.close_room(uuid, text) to anon, authenticated;

-- Hybrid RLS (participant SELECT) + Auth-only host (no host_token).
-- Apply after rooms-rematch.sql.

-- ── assert_host: Auth seat only ─────────────────────────────────────────────
drop function if exists public.assert_host(uuid, text);

create or replace function public.assert_host(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and is_host
      and user_id = auth.uid()
  ) then
    raise exception 'Not allowed';
  end if;
end;
$$;

revoke all on function public.assert_host(uuid) from public;
grant execute on function public.assert_host(uuid) to anon, authenticated;

-- ── Hybrid SELECT RLS ───────────────────────────────────────────────────────
-- Membership check must be SECURITY DEFINER so policies don't recurse into
-- room_players while evaluating room_players SELECT.
create or replace function public.is_room_participant(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_room_participant(uuid) from public;
grant execute on function public.is_room_participant(uuid) to anon, authenticated;

drop policy if exists "rooms are readable by everyone" on public.rooms;
drop policy if exists "rooms readable by participants" on public.rooms;
create policy "rooms readable by participants"
  on public.rooms for select
  using (public.is_room_participant(id));

drop policy if exists "room players are readable by everyone" on public.room_players;
drop policy if exists "room players readable by participants" on public.room_players;
create policy "room players readable by participants"
  on public.room_players for select
  using (public.is_room_participant(room_id));

drop policy if exists "room rounds are readable by everyone" on public.room_rounds;
drop policy if exists "room rounds readable by participants" on public.room_rounds;
create policy "room rounds readable by participants"
  on public.room_rounds for select
  using (public.is_room_participant(room_id));

drop policy if exists "room answers are readable by everyone" on public.room_answers;
drop policy if exists "room answers readable by participants" on public.room_answers;
create policy "room answers readable by participants"
  on public.room_answers for select
  using (public.is_room_participant(room_id));

drop policy if exists "rematch votes readable by everyone" on public.room_rematch_votes;
drop policy if exists "rematch votes readable by participants" on public.room_rematch_votes;
create policy "rematch votes readable by participants"
  on public.room_rematch_votes for select
  using (public.is_room_participant(room_id));

-- ── create_room without host_token ──────────────────────────────────────────
drop function if exists public.create_room(text, text, text, text, text, integer, integer, integer);
drop function if exists public.create_room(text, text, text, text, text, integer, integer, integer, text);

create or replace function public.create_room(
  p_pin text,
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
    'invite_secret', v_invite
  );
end;
$$;

revoke all on function public.create_room(text, text, text, text, integer, integer, integer, text) from public;
grant execute on function public.create_room(text, text, text, text, integer, integer, integer, text) to anon, authenticated;

-- ── Host RPCs without p_host_token ──────────────────────────────────────────
drop function if exists public.start_room_round(uuid, text, integer, uuid, text, jsonb, text, text, double precision, double precision);

create or replace function public.start_room_round(
  p_room_id uuid,
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
  perform public.assert_host(p_room_id);

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

drop function if exists public.begin_room_countdown(uuid, text, integer);

create or replace function public.begin_room_countdown(
  p_room_id uuid,
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
  perform public.assert_host(p_room_id);

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

drop function if exists public.kick_room_player(uuid, text, uuid);

create or replace function public.kick_room_player(
  p_room_id uuid,
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
  perform public.assert_host(p_room_id);

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

drop function if exists public.prune_idle_room_players(uuid, text, integer);

create or replace function public.prune_idle_room_players(
  p_room_id uuid,
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
  perform public.assert_host(p_room_id);

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

drop function if exists public.reveal_room_round(uuid, text, integer);

create or replace function public.reveal_room_round(
  p_room_id uuid,
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
  v_answer record;
begin
  perform public.assert_host(p_room_id);

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
    and coalesce(p.role, 'player') = 'player'
    and p.is_host = false
    and not exists (
      select 1 from public.room_answers as a
      where a.room_id = p_room_id
        and a.round_index = p_round_index
        and a.player_id = p.id
    );

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

  return jsonb_build_object('room', to_jsonb(v_room), 'round', to_jsonb(v_round));
end;
$$;

drop function if exists public.finish_room_game(uuid, text);

create or replace function public.finish_room_game(p_room_id uuid)
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
  perform public.assert_host(p_room_id);

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
    player_name, artist_slug, category, points, correct_count, rounds,
    mode, room_id, room_player_id, user_id, score_export_id
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

drop function if exists public.rotate_room_invite(uuid, text);

create or replace function public.rotate_room_invite(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_invite text := public.generate_room_invite_secret();
begin
  perform public.assert_host(p_room_id);

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

drop function if exists public.close_room(uuid, text);

create or replace function public.close_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_host(p_room_id);

  update public.rooms set status = 'closed' where id = p_room_id;
  delete from public.room_answers where room_id = p_room_id;
  delete from public.room_rounds where room_id = p_room_id;
  delete from public.room_players where room_id = p_room_id;
  delete from public.room_host_secrets where room_id = p_room_id;
  delete from public.room_invite_secrets where room_id = p_room_id;
end;
$$;

drop function if exists public.propose_rematch(uuid, text, integer);

create or replace function public.propose_rematch(
  p_room_id uuid,
  p_timeout_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.rooms;
  v_host public.room_players;
  v_new public.rooms;
  v_new_player public.room_players;
  v_invite text;
  v_timeout integer := greatest(15, least(coalesce(p_timeout_seconds, 60), 180));
begin
  perform public.assert_host(p_room_id);

  select * into v_old from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_old.status <> 'finished' then raise exception 'Game is not finished'; end if;
  if v_old.rematch_status = 'pending' and v_old.rematch_room_id is not null then
    raise exception 'Rematch already proposed';
  end if;

  select * into v_host
  from public.room_players
  where room_id = p_room_id and is_host = true
  limit 1;
  if not found then raise exception 'Host seat not found'; end if;

  v_invite := case
    when coalesce(v_old.visibility, 'public') = 'private' then public.generate_room_invite_secret()
    else null
  end;

  insert into public.rooms (
    pin, artist_slug, category, rounds, time_per_round, max_points, visibility
  )
  values (
    public.random_room_pin(),
    v_old.artist_slug,
    v_old.category,
    v_old.rounds,
    v_old.time_per_round,
    v_old.max_points,
    coalesce(v_old.visibility, 'public')
  )
  returning * into v_new;

  if v_invite is not null then
    insert into public.room_invite_secrets (room_id, invite_secret)
    values (v_new.id, v_invite);
  end if;

  insert into public.room_players (room_id, user_id, nickname, is_host, role)
  values (v_new.id, v_host.user_id, v_host.nickname, true, 'player')
  returning * into v_new_player;

  update public.rooms
  set host_player_id = v_new_player.id
  where id = v_new.id
  returning * into v_new;

  delete from public.room_rematch_votes where room_id = p_room_id;

  insert into public.room_rematch_votes (room_id, player_id, user_id, response)
  values (p_room_id, v_host.id, v_host.user_id, 'accepted');

  update public.rooms
  set rematch_room_id = v_new.id,
      rematch_deadline = now() + make_interval(secs => v_timeout),
      rematch_status = 'pending'
  where id = p_room_id
  returning * into v_old;

  return jsonb_build_object(
    'source_room', to_jsonb(v_old),
    'room', to_jsonb(v_new),
    'player', to_jsonb(v_new_player),
    'invite_secret', v_invite,
    'deadline', v_old.rematch_deadline
  );
end;
$$;

drop function if exists public.restart_room_game(uuid, text);

create or replace function public.restart_room_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Use propose_rematch';
end;
$$;

-- Stop using host secrets going forward (table may remain empty).
delete from public.room_host_secrets;

revoke all on function public.start_room_round(uuid, integer, uuid, text, jsonb, text, text, double precision, double precision) from public;
grant execute on function public.start_room_round(uuid, integer, uuid, text, jsonb, text, text, double precision, double precision) to anon, authenticated;
revoke all on function public.begin_room_countdown(uuid, integer) from public;
grant execute on function public.begin_room_countdown(uuid, integer) to anon, authenticated;
revoke all on function public.kick_room_player(uuid, uuid) from public;
grant execute on function public.kick_room_player(uuid, uuid) to anon, authenticated;
revoke all on function public.prune_idle_room_players(uuid, integer) from public;
grant execute on function public.prune_idle_room_players(uuid, integer) to anon, authenticated;
revoke all on function public.reveal_room_round(uuid, integer) from public;
grant execute on function public.reveal_room_round(uuid, integer) to anon, authenticated;
revoke all on function public.finish_room_game(uuid) from public;
grant execute on function public.finish_room_game(uuid) to anon, authenticated;
revoke all on function public.rotate_room_invite(uuid) from public;
grant execute on function public.rotate_room_invite(uuid) to anon, authenticated;
revoke all on function public.close_room(uuid) from public;
grant execute on function public.close_room(uuid) to anon, authenticated;
revoke all on function public.propose_rematch(uuid, integer) from public;
grant execute on function public.propose_rematch(uuid, integer) to anon, authenticated;
revoke all on function public.restart_room_game(uuid) from public;
grant execute on function public.restart_room_game(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

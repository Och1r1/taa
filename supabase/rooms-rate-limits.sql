-- Rate limits for multiplayer RPCs (per auth.uid(), sliding fixed windows).
-- Apply after rooms-rls-auth-host.sql.

create table if not exists public.rpc_rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.rpc_rate_limits enable row level security;
-- No anon policies: only security definer RPCs touch this table.

create or replace function public.assert_rate_limit(
  p_action text,
  p_max_hits integer,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_window integer := greatest(5, coalesce(p_window_seconds, 60));
  v_max integer := greatest(1, coalesce(p_max_hits, 10));
  v_start timestamptz;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  insert into public.rpc_rate_limits (user_id, action, window_start, hit_count)
  values (v_uid, p_action, v_start, 1)
  on conflict (user_id, action, window_start) do update
    set hit_count = public.rpc_rate_limits.hit_count + 1
  returning hit_count into v_count;

  if v_count > v_max then
    raise exception 'Хэт олон оролдлого. Түр хүлээнэ үү.';
  end if;

  -- Opportunistic cleanup of old windows for this user/action.
  delete from public.rpc_rate_limits
  where user_id = v_uid
    and action = p_action
    and window_start < now() - make_interval(secs => v_window * 3);
end;
$$;

revoke all on function public.assert_rate_limit(text, integer, integer) from public;
grant execute on function public.assert_rate_limit(text, integer, integer) to anon, authenticated;

-- Patch create_room: rate-limit then same body as rooms-rls-auth-host.sql
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
  perform public.assert_rate_limit('create_room', 8, 60);

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
  perform public.assert_rate_limit('join_room', 20, 60);

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

-- Rematch rate limits (bodies match rooms-rls-auth-host / rooms-rematch after auth host).
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
  perform public.assert_rate_limit('propose_rematch', 6, 60);
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

create or replace function public.respond_rematch(
  p_room_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.rooms;
  v_seat public.room_players;
  v_new public.rooms;
  v_new_player public.room_players;
  v_user_id uuid := auth.uid();
  v_invite text;
  v_pending integer;
  v_response text := case when p_accept then 'accepted' else 'declined' end;
begin
  perform public.assert_rate_limit('respond_rematch', 20, 60);

  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_old from public.rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_old.status <> 'finished' then raise exception 'Game is not finished'; end if;
  if v_old.rematch_status is distinct from 'pending' or v_old.rematch_room_id is null then
    raise exception 'No rematch pending';
  end if;
  if v_old.rematch_deadline is not null and v_old.rematch_deadline < now() then
    update public.rooms set rematch_status = 'cancelled' where id = p_room_id;
    raise exception 'Rematch timed out';
  end if;

  select * into v_seat
  from public.room_players
  where room_id = p_room_id and user_id = v_user_id;
  if not found then raise exception 'Player not in room'; end if;

  insert into public.room_rematch_votes (room_id, player_id, user_id, response)
  values (p_room_id, v_seat.id, v_user_id, v_response)
  on conflict (room_id, player_id) do update
    set response = excluded.response,
        created_at = now();

  if not p_accept then
    select count(*) into v_pending
    from public.room_players p
    where p.room_id = p_room_id
      and p.is_host = false
      and not exists (
        select 1 from public.room_rematch_votes v
        where v.room_id = p_room_id and v.player_id = p.id
      );
    if v_pending = 0 then
      update public.rooms set rematch_status = 'completed' where id = p_room_id;
    end if;
    return jsonb_build_object('accepted', false, 'source_room_id', p_room_id);
  end if;

  select * into v_new from public.rooms where id = v_old.rematch_room_id for update;
  if not found then raise exception 'Rematch room not found'; end if;
  if v_new.status <> 'lobby' then raise exception 'Rematch room is not accepting players'; end if;

  select * into v_new_player
  from public.room_players
  where room_id = v_new.id and user_id = v_user_id;
  if not found then
    insert into public.room_players (room_id, user_id, nickname, is_host, role)
    values (
      v_new.id,
      v_user_id,
      v_seat.nickname,
      false,
      coalesce(v_seat.role, 'player')
    )
    returning * into v_new_player;
  end if;

  select invite_secret into v_invite
  from public.room_invite_secrets
  where room_id = v_new.id;

  select count(*) into v_pending
  from public.room_players p
  where p.room_id = p_room_id
    and p.is_host = false
    and not exists (
      select 1 from public.room_rematch_votes v
      where v.room_id = p_room_id and v.player_id = p.id
    );
  if v_pending = 0 then
    update public.rooms set rematch_status = 'completed' where id = p_room_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'room', to_jsonb(v_new),
    'player', to_jsonb(v_new_player),
    'invite_secret', v_invite,
    'host_token', null
  );
end;
$$;

-- Answer spam protection (Auth seat + spectator block from rooms-private-spectators).
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
  perform public.assert_rate_limit('submit_answer', 40, 60);

  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'playing' then raise exception 'Round is not active'; end if;

  select * into v_player from public.room_players
  where room_id = p_room_id and user_id = auth.uid();
  if not found then raise exception 'Player not in room'; end if;
  if v_player.id is distinct from p_player_id then raise exception 'Not allowed'; end if;
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

notify pgrst, 'reload schema';

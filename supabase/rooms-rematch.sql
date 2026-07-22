-- Full rematch: host proposes a new lobby; guests accept/decline before a deadline.
-- Apply after rooms-profiles.sql (or after rooms-private-spectators.sql).
-- Replaces same-room restart_room_game.

alter table public.rooms
  add column if not exists rematch_room_id uuid references public.rooms (id) on delete set null,
  add column if not exists rematch_deadline timestamptz,
  add column if not exists rematch_status text;

alter table public.rooms drop constraint if exists rooms_rematch_status_check;
alter table public.rooms
  add constraint rooms_rematch_status_check
  check (rematch_status is null or rematch_status in ('pending', 'completed', 'cancelled'));

create table if not exists public.room_rematch_votes (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  player_id uuid not null references public.room_players (id) on delete cascade,
  user_id   uuid references auth.users (id) on delete set null,
  response  text not null check (response in ('accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (room_id, player_id)
);

alter table public.room_rematch_votes enable row level security;

drop policy if exists "rematch votes readable by everyone" on public.room_rematch_votes;
create policy "rematch votes readable by everyone"
  on public.room_rematch_votes for select
  using (true);

create or replace function public.random_room_pin()
returns text
language plpgsql
as $$
declare
  v_pin text;
  v_tries integer := 0;
begin
  loop
    v_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.rooms where pin = v_pin);
    v_tries := v_tries + 1;
    if v_tries > 40 then
      raise exception 'PIN олдсонгүй';
    end if;
  end loop;
  return v_pin;
end;
$$;

-- Host creates a fresh lobby and opens a timed accept window on the finished room.
create or replace function public.propose_rematch(
  p_room_id uuid,
  p_host_token text,
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
  v_host_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_invite text;
  v_timeout integer := greatest(15, least(coalesce(p_timeout_seconds, 60), 180));
begin
  perform public.assert_host(p_room_id, p_host_token);

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

  insert into public.room_host_secrets (room_id, host_token)
  values (v_new.id, v_host_token);

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
    'host_token', v_host_token,
    'invite_secret', v_invite,
    'deadline', v_old.rematch_deadline
  );
end;
$$;

revoke all on function public.propose_rematch(uuid, text, integer) from public;
grant execute on function public.propose_rematch(uuid, text, integer) to anon, authenticated;

-- Guest (or late host restore) accepts or declines the rematch offer.
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

revoke all on function public.respond_rematch(uuid, boolean) from public;
grant execute on function public.respond_rematch(uuid, boolean) to anon, authenticated;

-- Same-room restart is retired; keep a stub so old clients get a clear error.
create or replace function public.restart_room_game(
  p_room_id uuid,
  p_host_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Use propose_rematch';
end;
$$;

notify pgrst, 'reload schema';

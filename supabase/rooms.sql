-- Таа — multiplayer rooms (Хамтдаа), Phase 1: create / join / lobby
-- Run after category-catalog.sql.
-- Enables PIN lobbies with a live player list via Supabase Realtime.
-- Host actions are gated by host_token stored in room_host_secrets (not Realtime).

create table if not exists public.rooms (
  id                   uuid primary key default gen_random_uuid(),
  pin                  text not null unique check (pin ~ '^[0-9]{6}$'),
  status               text not null default 'lobby'
                         check (status in ('lobby', 'playing', 'revealing', 'finished', 'closed')),
  host_player_id       uuid,
  artist_slug          text not null,
  category             text not null,
  rounds               integer not null check (rounds between 1 and 20),
  time_per_round       integer not null check (time_per_round between 5 and 60),
  max_points           integer not null default 1000 check (max_points > 0),
  current_round_index  integer not null default 0 check (current_round_index >= 0),
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null default (now() + interval '2 hours')
);

-- Drop legacy column if an earlier draft of this script added it.
alter table public.rooms drop column if exists host_token;

create index if not exists rooms_pin_idx on public.rooms (pin);
create index if not exists rooms_status_expires_idx on public.rooms (status, expires_at);

create table if not exists public.room_players (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  nickname       text not null check (char_length(nickname) between 1 and 24),
  is_host        boolean not null default false,
  score          integer not null default 0 check (score >= 0),
  correct_count  integer not null default 0 check (correct_count >= 0),
  joined_at      timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  unique (room_id, nickname)
);

create index if not exists room_players_room_id_idx on public.room_players (room_id);

-- Host secret stays off Realtime / public SELECT so PIN guests cannot steal host control.
create table if not exists public.room_host_secrets (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  host_token text not null check (char_length(host_token) >= 16)
);

alter table public.rooms drop constraint if exists rooms_host_player_fkey;
alter table public.rooms
  add constraint rooms_host_player_fkey
  foreign key (host_player_id) references public.room_players (id) on delete set null;

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_host_secrets enable row level security;

drop policy if exists "rooms are readable by everyone" on public.rooms;
create policy "rooms are readable by everyone"
  on public.rooms for select
  using (true);

drop policy if exists "room players are readable by everyone" on public.room_players;
create policy "room players are readable by everyone"
  on public.room_players for select
  using (true);

-- No SELECT/INSERT/UPDATE policies on room_host_secrets for anon — only security-definer RPCs.

-- Realtime: broadcast lobby changes to subscribed clients.
do $$
begin
  begin
    alter publication supabase_realtime add table public.rooms;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.room_players;
  exception
    when duplicate_object then null;
  end;
end;
$$;

-- ── RPCs ────────────────────────────────────────────────────────────────────

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
begin
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be 6 digits';
  end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 24 then
    raise exception 'Nickname must be 1–24 characters';
  end if;
  if char_length(p_host_token) < 16 then
    raise exception 'Invalid host token';
  end if;

  insert into public.rooms (
    pin, artist_slug, category, rounds, time_per_round, max_points
  )
  values (
    p_pin, p_artist_slug, p_category, p_rounds, p_time_per_round, p_max_points
  )
  returning * into v_room;

  insert into public.room_host_secrets (room_id, host_token)
  values (v_room.id, p_host_token);

  insert into public.room_players (room_id, nickname, is_host)
  values (v_room.id, v_nickname, true)
  returning * into v_player;

  update public.rooms
  set host_player_id = v_player.id
  where id = v_room.id
  returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'player', to_jsonb(v_player),
    'host_token', p_host_token
  );
end;
$$;

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
  v_count integer;
  v_max_players constant integer := 20;
begin
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be 6 digits';
  end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 24 then
    raise exception 'Nickname must be 1–24 characters';
  end if;

  select * into v_room
  from public.rooms
  where pin = p_pin
  for update;

  if not found then
    raise exception 'Room not found';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'Room is not accepting players';
  end if;
  if v_room.expires_at <= now() then
    update public.rooms set status = 'closed' where id = v_room.id;
    raise exception 'Room has expired';
  end if;

  select count(*) into v_count from public.room_players where room_id = v_room.id;
  if v_count >= v_max_players then
    raise exception 'Room is full';
  end if;

  if exists (
    select 1 from public.room_players
    where room_id = v_room.id and lower(nickname) = lower(v_nickname)
  ) then
    raise exception 'Nickname already taken';
  end if;

  insert into public.room_players (room_id, nickname, is_host)
  values (v_room.id, v_nickname, false)
  returning * into v_player;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'player', to_jsonb(v_player)
  );
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
  select * into v_player
  from public.room_players
  where id = p_player_id and room_id = p_room_id;

  if not found then
    return;
  end if;

  delete from public.room_players where id = p_player_id;

  if v_player.is_host then
    update public.rooms set status = 'closed', host_player_id = null
    where id = p_room_id;
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
  delete from public.room_players where room_id = p_room_id;
  delete from public.room_host_secrets where room_id = p_room_id;
end;
$$;

grant execute on function public.create_room(text, text, text, text, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.join_room(text, text) to anon, authenticated;
grant execute on function public.leave_room(uuid, uuid) to anon, authenticated;
grant execute on function public.close_room(uuid, text) to anon, authenticated;

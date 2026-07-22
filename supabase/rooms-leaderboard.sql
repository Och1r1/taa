-- Таа — multiplayer leaderboard export, Phase 4 step 4.
-- Run AFTER rooms-auth.sql (and leaderboard.sql / category-leaderboard.sql).
-- Saves every participant once per finished match; rematch clears the export
-- marker so the next finish can write a new batch.

-- ── scores: mode + room metadata ────────────────────────────────────────────
alter table public.scores
  add column if not exists mode text;

update public.scores
set mode = 'solo'
where mode is null;

alter table public.scores
  alter column mode set default 'solo',
  alter column mode set not null;

alter table public.scores drop constraint if exists scores_mode_check;
alter table public.scores
  add constraint scores_mode_check check (mode in ('solo', 'multi'));

alter table public.scores
  add column if not exists room_id uuid references public.rooms (id) on delete set null;

alter table public.scores
  add column if not exists room_player_id uuid;

alter table public.scores
  add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.scores
  add column if not exists score_export_id uuid;

create index if not exists scores_mode_category_points_idx
  on public.scores (mode, category, points desc, created_at asc);

create unique index if not exists scores_multi_export_player_idx
  on public.scores (score_export_id, room_player_id)
  where mode = 'multi' and score_export_id is not null and room_player_id is not null;

-- Solo inserts stay open; multi rows are written only by security-definer RPCs.
drop policy if exists "anyone can submit a score" on public.scores;
create policy "anyone can submit a solo score"
  on public.scores for insert
  with check (
    mode = 'solo'
    and char_length(player_name) between 1 and 24
    and points >= 0
    and room_id is null
    and score_export_id is null
  );

-- ── rooms: one export batch per finished match ──────────────────────────────
alter table public.rooms
  add column if not exists score_export_id uuid;

-- Finish the room and export every seated player's score exactly once.
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

  -- Idempotent: a finished room that already exported keeps its batch.
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
    -- Another finish raced us; return the room as-is.
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
  where p.room_id = p_room_id;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'scores_saved', v_inserted,
    'already_saved', false
  );
end;
$$;

-- Rematch clears the export marker so the next finish can save a new batch.
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
      countdown_ends_at = null,
      score_export_id = null
  where id = p_room_id
  returning * into v_room;

  return to_jsonb(v_room);
end;
$$;

grant execute on function public.finish_room_game(uuid, text) to anon, authenticated;
grant execute on function public.restart_room_game(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

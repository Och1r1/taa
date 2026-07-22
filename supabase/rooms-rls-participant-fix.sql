-- Fix infinite recursion in room_players SELECT policy.
-- The policy previously queried room_players inside its own USING clause.
-- Apply after rooms-rls-auth-host.sql (safe to re-run).

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

drop policy if exists "rooms readable by participants" on public.rooms;
create policy "rooms readable by participants"
  on public.rooms for select
  using (public.is_room_participant(id));

drop policy if exists "room players readable by participants" on public.room_players;
create policy "room players readable by participants"
  on public.room_players for select
  using (public.is_room_participant(room_id));

drop policy if exists "room rounds readable by participants" on public.room_rounds;
create policy "room rounds readable by participants"
  on public.room_rounds for select
  using (public.is_room_participant(room_id));

drop policy if exists "room answers readable by participants" on public.room_answers;
create policy "room answers readable by participants"
  on public.room_answers for select
  using (public.is_room_participant(room_id));

drop policy if exists "rematch votes readable by participants" on public.room_rematch_votes;
create policy "rematch votes readable by participants"
  on public.room_rematch_votes for select
  using (public.is_room_participant(room_id));

notify pgrst, 'reload schema';

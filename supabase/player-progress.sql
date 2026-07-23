-- Cross-device player progression. Apply after rooms-profiles.sql.

create table if not exists public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_progress enable row level security;
drop policy if exists "players read own progress" on public.player_progress;
create policy "players read own progress" on public.player_progress for select using (auth.uid() = user_id);
drop policy if exists "players insert own progress" on public.player_progress;
create policy "players insert own progress" on public.player_progress for insert with check (auth.uid() = user_id);
drop policy if exists "players update own progress" on public.player_progress;
create policy "players update own progress" on public.player_progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_player_progress_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists player_progress_touch_updated_at on public.player_progress;
create trigger player_progress_touch_updated_at before update on public.player_progress
for each row execute function public.touch_player_progress_updated_at();

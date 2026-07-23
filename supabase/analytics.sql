-- Product analytics events. Apply after rooms-profiles.sql.
-- Events are associated with the current anonymous or signed-in auth user.

create table if not exists public.analytics_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_name text not null check (event_name in (
    'game_started', 'game_completed', 'daily_started', 'daily_completed', 'result_shared'
  )),
  occurred_at timestamptz not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, occurred_at desc);

alter table public.analytics_events enable row level security;
drop policy if exists "players insert own analytics events" on public.analytics_events;
create policy "players insert own analytics events"
  on public.analytics_events for insert
  with check (auth.uid() = user_id);

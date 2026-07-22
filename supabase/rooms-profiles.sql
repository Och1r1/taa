-- Profiles: display name tied to auth.users (anonymous or email).
-- Apply after rooms-private-spectators.sql. Requires Anonymous Sign-Ins (or any Auth user).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or (char_length(trim(display_name)) between 2 and 24)
  ),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profile_updated_at();

-- Ensure a row exists for the current user; optionally set display_name.
create or replace function public.ensure_profile(p_display_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p_display_name), '');
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'Нэвтэрсэн байх шаардлагатай';
  end if;

  if v_name is not null and (char_length(v_name) < 2 or char_length(v_name) > 24) then
    raise exception 'Нэр 2–24 тэмдэгт байх ёстой';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, public.profiles.display_name)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ensure_profile(text) from public;
grant execute on function public.ensure_profile(text) to anon, authenticated;

-- Update only the display name for the current user.
create or replace function public.update_display_name(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(p_display_name);
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'Нэвтэрсэн байх шаардлагатай';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'Нэр 2–24 тэмдэгт байх ёстой';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do update
    set display_name = excluded.display_name
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.update_display_name(text) from public;
grant execute on function public.update_display_name(text) to anon, authenticated;

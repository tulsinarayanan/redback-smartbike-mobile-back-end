
alter table public.profiles
  add column if not exists level integer not null default 1;

alter table public.profiles
  add column if not exists xp integer not null default 0;

alter table public.profiles
  add column if not exists streak_days integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_level_check'
  ) then
    alter table public.profiles add constraint profiles_level_check check (level >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_xp_check'
  ) then
    alter table public.profiles add constraint profiles_xp_check check (xp >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_streak_days_check'
  ) then
    alter table public.profiles add constraint profiles_streak_days_check check (streak_days >= 0);
  end if;
end $$;

create index if not exists profiles_level_idx on public.profiles (level);
create index if not exists profiles_xp_idx on public.profiles (xp);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  xp_reward integer not null default 0,
  icon text,
  created_at timestamptz not null default now(),
  constraint achievements_name_unique unique (name),
  constraint achievements_xp_reward_check check (xp_reward >= 0)
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  constraint user_achievements_unique unique (user_id, achievement_id)
);

create index if not exists user_achievements_user_idx on public.user_achievements (user_id);
create index if not exists user_achievements_achievement_idx on public.user_achievements (achievement_id);

insert into public.achievements (name, description, xp_reward, icon) values
  ('First Ride', 'Complete your first ride', 50, '🚴'),
  ('Streak Starter', 'Maintain a 3-day ride streak', 100, '🔥'),
  ('Century Rider', 'Ride 100 km total', 150, '🏆'),
  ('Early Bird', 'Complete a ride before 7am', 30, '🌅'),
  ('Night Owl', 'Complete a ride after 9pm', 30, '🌙')
on conflict (name) do nothing;

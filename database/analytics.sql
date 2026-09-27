create extension if not exists pgcrypto;

create table if not exists public.ride_analytics (
  analytics_id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(ride_id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  hr_zone_1_recovery_sec integer not null default 0,
  hr_zone_2_aerobic_sec integer not null default 0,
  hr_zone_3_tempo_sec integer not null default 0,
  hr_zone_4_threshold_sec integer not null default 0,
  hr_zone_5_anaerobic_sec integer not null default 0,
  peak_power_5s numeric not null default 0,
  peak_power_1m numeric not null default 0,
  peak_power_5m numeric not null default 0,
  normalized_power numeric not null default 0,
  intensity_factor numeric not null default 0,
  avg_cadence numeric not null default 0,
  max_heart_rate integer not null default 0,
  max_power numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint ride_analytics_hr_zones_check check (
    hr_zone_1_recovery_sec >= 0 and
    hr_zone_2_aerobic_sec >= 0 and
    hr_zone_3_tempo_sec >= 0 and
    hr_zone_4_threshold_sec >= 0 and
    hr_zone_5_anaerobic_sec >= 0
  )
);

create index if not exists ride_analytics_ride_id_idx on public.ride_analytics (ride_id);
create index if not exists ride_analytics_user_id_idx on public.ride_analytics (user_id);
create index if not exists ride_analytics_created_at_idx on public.ride_analytics (created_at desc);

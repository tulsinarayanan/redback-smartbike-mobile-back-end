-- SmartBike Supabase schema
-- Apply this in the company Supabase SQL editor before switching the app env vars.
-- Notes:
-- - public.profiles.id references auth.users(id). Create users through Supabase Auth.
-- - No real users, passwords, or secrets are included here.
-- - Supabase usually provides gen_random_uuid(); the extension is included for portability.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default auth.uid(),
  email text not null,
  name text,
  username text,
  avatar_url text,
  age smallint,
  height numeric,
  weight numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  constraint profiles_id_auth_users_fk
    foreign key (id) references auth.users(id) on delete cascade
);

create unique index if not exists profiles_email_unique_idx
  on public.profiles (lower(email));

create index if not exists profiles_username_idx
  on public.profiles (username);

create table if not exists public.rides (
  ride_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time timestamp,
  end_time timestamp,
  duration integer,
  distance numeric default 0,
  avg_speed numeric,
  calories numeric default 0,
  updated_at timestamptz default now()
);

create index if not exists rides_user_id_idx
  on public.rides (user_id);

create index if not exists rides_user_start_time_idx
  on public.rides (user_id, start_time desc);

create table if not exists public.sensor_data (
  data_id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.rides(ride_id) on delete set null,
  timestamp timestamptz default now(),
  speed numeric,
  cadence numeric,
  heart_rate numeric,
  power numeric,
  updated_at timestamptz default now()
);

create index if not exists sensor_data_ride_id_idx
  on public.sensor_data (ride_id);

create index if not exists sensor_data_timestamp_idx
  on public.sensor_data (timestamp desc);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references public.profiles(id) on delete cascade,
  addressee_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  constraint friendships_status_check
    check (status in ('pending', 'accepted', 'blocked')),
  constraint friendships_no_self_check
    check (requester_id is null or addressee_id is null or requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_unique_idx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where requester_id is not null and addressee_id is not null;

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id, conversation_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create index if not exists messages_sender_idx
  on public.messages (sender_id);

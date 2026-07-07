-- Messaging app — initial schema. Canonical source of truth; mirror any change
-- into frontend/lib/db/schema.ts.
--
-- Access model: the FastAPI backend talks to Postgres over DATABASE_URL, which
-- bypasses RLS. The browser never queries the DB directly (it goes through the
-- backend), so every table has RLS enabled with NO policies: reachable only by
-- trusted server code, invisible to the anon/authenticated Supabase client.

create extension if not exists pgcrypto;

-- Users ----------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

alter table public.users enable row level security;

-- Groups ----------------------------------------------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references public.users(id) on delete cascade,
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

-- Messages --------------------------------------------------------------------
-- A message targets EITHER a group (group_id set) OR another user
-- (recipient_id set) — never both, never neither.
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.users(id) on delete cascade,
  group_id     uuid references public.groups(id) on delete cascade,
  recipient_id uuid references public.users(id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now(),
  constraint messages_one_target check ((group_id is not null) <> (recipient_id is not null))
);

alter table public.messages enable row level security;

create index if not exists messages_group_created_idx
  on public.messages (group_id, created_at);
create index if not exists messages_dm_created_idx
  on public.messages (sender_id, recipient_id, created_at);

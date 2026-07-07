-- Image attachments. Additive migration (safe for existing data).
-- Files live on the backend disk (backend/uploads); this table is the index.

create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.users(id) on delete cascade,
  filename    text not null,
  mime_type   text not null,
  size_bytes  bigint not null,
  path        text not null,
  created_at  timestamptz not null default now()
);

alter table public.attachments enable row level security;

-- A message may now carry an image instead of (or alongside) text.
alter table public.messages
  add column if not exists attachment_id uuid references public.attachments(id) on delete set null;

alter table public.messages alter column body drop not null;

-- ...but it must carry at least one of the two.
alter table public.messages
  add constraint messages_body_or_attachment
  check (body is not null or attachment_id is not null);

-- Presence: last_seen is stamped when a user's last WebSocket disconnects.
-- Online/offline itself is derived live from active sockets (in memory).

alter table public.users add column if not exists last_seen timestamptz;

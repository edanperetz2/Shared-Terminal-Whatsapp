# Shared-Terminal Messenger

A real-time messaging app where every group chat comes with a **live shared terminal**: one shell session per group, mirrored to every member who has the chat open, so a team can talk and run commands in the same place.

Built with Next.js 16 + TypeScript on the frontend and FastAPI + PostgreSQL on the backend, with WebSockets for live delivery.

## Features

- **Accounts**: sign-up and login with bcrypt-hashed passwords and JWT bearer tokens
- **Direct messages and groups**: one-to-one conversations and named group chats with membership checks on every read and write
- **Live delivery**: new messages are pushed over a WebSocket to every open tab of every recipient, with no polling
- **Presence**: online/offline status derived from open sockets, plus a persisted "last seen" timestamp
- **Image attachments**: PNG, JPEG, GIF and WebP up to 10 MB, served only to authenticated members of the conversation
- **Shared terminal**: an [xterm.js](https://xtermjs.org/) terminal in each group, backed by a real pseudo-terminal on the server

## How the shared terminal works

```
member A ─┐                      ┌─ background thread reads the PTY
member B ─┼─ WS /api/ws/terminal/{group_id} ─┤
member C ─┘                      └─ output fanned out to every socket
```

- The shell session is created lazily when the first member connects and killed when the last one leaves.
- Keystrokes from any member go to the same shell; output is broadcast to everyone.
- A scrollback buffer (about 20,000 characters) is replayed to members who join late, so everyone sees the same screen.
- Terminal resizes from the browser are forwarded to the PTY. Works on Linux and macOS (`pty`) and on Windows (`pywinpty`).
- The socket authenticates with the user's JWT and checks group membership before attaching.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, xterm.js |
| Backend | FastAPI, Uvicorn, psycopg 3 with a connection pool, PyJWT, bcrypt |
| Database | PostgreSQL (Supabase locally), versioned SQL migrations, Drizzle schema mirror for typed queries |
| Realtime | Native WebSockets: one channel for messages and presence, one per group terminal |

## Project structure

```
frontend/
  app/                 pages: chat, login, signup
  components/chat/     chat shell, sidebar, conversation view, shared terminal, authenticated images
  lib/                 API client, auth context, WebSocket URL helper, Drizzle schema
backend/
  main.py              app setup and router wiring
  auth.py, security.py signup/login, JWTs, current-user dependency
  messaging.py         groups, DMs, group messages, realtime WebSocket
  realtime.py          in-memory socket registry and broadcast
  terminal.py          shared PTY sessions and the terminal WebSocket
  attachments.py       image upload and authenticated download
supabase/migrations/   canonical SQL schema
```

## Running locally

Requires Node.js, Python 3, and Docker with the Supabase CLI for the database.

```bash
python3 setup.py                 # installs dependencies and creates env files

# terminal 1: backend
cd backend && .venv/bin/uvicorn main:app --reload --port 8080

# terminal 2: frontend
cd frontend && npm run dev       # http://localhost:3000

# database
supabase start                   # paste the printed anon key into frontend/.env.local
supabase db reset                # applies supabase/migrations/
```

The frontend calls relative `/api/*` paths, which Next.js rewrites to the FastAPI backend.

## Security note

The shared terminal runs a **real shell on the backend host**, with the permissions of the backend process, for any member of a group. That is the point of the feature, but it means this app should only run locally or for a trusted group, inside a container or VM, and never as a public deployment.

## Limitations

- The socket registry and terminal sessions live in memory, so the backend runs as a single process. Scaling out would need a shared pub/sub layer such as Redis.
- Attachments are stored on local disk and indexed in the database.

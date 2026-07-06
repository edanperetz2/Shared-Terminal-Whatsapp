# WhatsApp+ — mini README

A small WhatsApp-style chat app with one extra twist: you can drop a **shared
live terminal** into any chat. Built as a 2-hour vertical slice — every feature
works end to end, with fake data and no login.

## Features
- **Direct messages** (1-to-1) and **group chats**
- **Typing indicator** ("Alice is typing…")
- **Attachments — two kinds only:** a **photo**, or a **terminal**
- **Shared terminal:** a real PowerShell that several people open at once —
  everyone sees the output and everyone can type (one shell per chat)

## Stack
- **Frontend:** Next.js 16 + React + Tailwind + shadcn/ui, terminal drawn with xterm
- **Backend:** FastAPI (Python). All data lives **in memory** (no database)
- **Terminal shell:** `pywinpty` (runs PowerShell on the host)

## Run it
```bash
# Backend (port 8080) — run WITHOUT --reload for a demo so state isn't wiped
cd backend && .venv/Scripts/python -m uvicorn main:app --port 8080 --host 127.0.0.1

# Frontend (port 3000) — separate terminal
cd frontend && npm run dev
```
Then open two windows to act as two people:
- http://localhost:3000/?me=alice
- http://localhost:3000/?me=bob

There's **no login** — the `?me=` in the address is who you are. That's how you
demo a real conversation between two windows.

## How the flow works (start to finish)

1. **Pick who you are.** `/?me=alice` sets your identity. The sidebar loads your
   chats from `GET /api/conversations?me=alice`.
2. **Open a chat.** The chat screen starts asking the backend for new messages
   every ~2 seconds: `GET /api/messages?conversationId=…&after=<last-seen-time>`.
   This "keep asking" approach is called **polling**.
3. **Type a message.** While typing, the app quietly tells the backend
   `POST /api/typing`. The other window is polling `GET /api/typing`, so it shows
   "Alice is typing…".
4. **Send it.** `POST /api/messages` adds the message to the backend's memory.
   The other window's next poll (within ~2s) picks it up.
5. **Send a photo.** The image is turned into text-encoded data (base64, capped
   at 2MB) and sent inside the message, so everyone sees it inline.
6. **Share a terminal.** The `>_` button calls `POST /api/terminals` (one shared
   terminal per chat — if the chat already has one, it reuses it). A "🖥️ terminal"
   card drops into the chat.
7. **Open the shared shell.** Clicking the card opens a black terminal docked at
   the bottom of the chat. It connects **straight to the backend** over a
   WebSocket (an always-open two-way link): `ws://127.0.0.1:8080/ws/terminal/<id>`.
   The backend keeps **one PowerShell per terminal id** and a list of everyone
   watching it. Whatever the shell prints is sent to **all** of them; whatever
   **any** of them types is fed into the shell → everyone shares one live session.

### Data flow in one line
Browser (polls `/api/*` for chat) ⇄ Next.js proxy ⇄ FastAPI (holds all data in
memory). The **terminal** skips the proxy and talks to FastAPI directly over a
WebSocket, because it must be instant.

## Key files
| File | What it does |
|---|---|
| `backend/main.py` | All chat data + endpoints (users, chats, messages, typing, terminals) |
| `backend/terminal.py` | The shared PowerShell: one shell per id, streamed to everyone |
| `frontend/app/page.tsx` | Home page — shows the chat app |
| `frontend/components/chat-app.tsx` | The whole WhatsApp screen (sidebar, chat, new chat/group) |
| `frontend/components/terminal-view.tsx` | The black terminal window (xterm + WebSocket) |
| `frontend/lib/api.ts` | Small helper for calling the backend |

## Deliberate limitations (traded away for speed)
- **In-memory only** — restarting the backend wipes all chats and terminals.
- **Polling, not push** — up to ~2s delay on messages, ~4s on typing.
- **No auth** — identity is just the URL; not secure.
- **Real shell on the host** — anyone who opens a shared terminal can run real
  commands on the machine. Fine for a local demo, never for the public internet.
- **Known rough edges:** the terminal stays open when you switch chats, and
  "Create group" needs a name typed before it works (no warning if it's blank).

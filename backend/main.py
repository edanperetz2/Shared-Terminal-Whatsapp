"""WhatsApp+ MVP backend — everything in memory, no database, no login.

Run with: .venv/Scripts/uvicorn main:app --port 8080   (no --reload for demos)

The Next.js frontend proxies /api/* here. The shared terminal uses a WebSocket
at /ws/terminal/{id}, which the browser connects to directly on port 8080.
"""

import time
import uuid
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from terminal import register_terminal, terminal_websocket

load_dotenv()

app = FastAPI(title="WhatsApp+ API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


# ---------------------------------------------------------------------------
# In-memory state (wiped on restart)
# ---------------------------------------------------------------------------

# id -> {id, displayName, color}
USERS: dict[str, dict] = {}
# list of {id, type, name, memberIds, createdBy}
CONVERSATIONS: list[dict] = []
# list of {id, conversationId, senderId, body, attachment, createdAtMs}
MESSAGES: list[dict] = []
# (conversationId, userId) -> lastTypingAtMs
TYPING: dict[tuple[str, str], int] = {}
# id -> {id, name, createdBy, createdAtMs}
TERMINALS: dict[str, dict] = {}
# conversationId -> terminalId (so each conversation reuses one shared terminal)
CONVERSATION_TERMINALS: dict[str, str] = {}


def seed() -> None:
    palette = {
        "alice": "#25D366",
        "bob": "#34B7F1",
        "carol": "#8B5CF6",
        "dave": "#F59E0B",
    }
    for uid, color in palette.items():
        USERS[uid] = {"id": uid, "displayName": uid.capitalize(), "color": color}

    dm = {
        "id": new_id(),
        "type": "dm",
        "name": None,
        "memberIds": ["alice", "bob"],
        "createdBy": "alice",
    }
    group = {
        "id": new_id(),
        "type": "group",
        "name": "Team Chat",
        "memberIds": ["alice", "bob", "carol"],
        "createdBy": "alice",
    }
    CONVERSATIONS.extend([dm, group])
    MESSAGES.append(
        {
            "id": new_id(),
            "conversationId": dm["id"],
            "senderId": "bob",
            "body": "Hey! Welcome to WhatsApp+ 👋",
            "attachment": None,
            "createdAtMs": now_ms(),
        }
    )


seed()


def require_user(user_id: Optional[str]) -> dict:
    user = USERS.get(user_id or "")
    if not user:
        raise HTTPException(status_code=400, detail="unknown user")
    return user


def conversation_view(conv: dict, me: str) -> dict:
    """Shape a conversation for the sidebar: name to show + last message."""
    if conv["type"] == "dm":
        other_id = next((m for m in conv["memberIds"] if m != me), me)
        title = USERS.get(other_id, {}).get("displayName", "Unknown")
    else:
        title = conv["name"]
    msgs = [m for m in MESSAGES if m["conversationId"] == conv["id"]]
    last = msgs[-1] if msgs else None
    preview = ""
    if last:
        if last["attachment"]:
            preview = "📷 Photo" if last["attachment"]["kind"] == "photo" else "🖥️ Terminal"
        else:
            preview = last["body"] or ""
    return {
        "id": conv["id"],
        "type": conv["type"],
        "title": title,
        "memberIds": conv["memberIds"],
        "lastMessage": preview,
        "lastAtMs": last["createdAtMs"] if last else 0,
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "fastapi"}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@app.get("/api/users")
async def list_users() -> list[dict]:
    return list(USERS.values())


# ---------------------------------------------------------------------------
# Conversations (DMs + groups)
# ---------------------------------------------------------------------------


@app.get("/api/conversations")
async def list_conversations(me: str) -> list[dict]:
    require_user(me)
    mine = [c for c in CONVERSATIONS if me in c["memberIds"]]
    views = [conversation_view(c, me) for c in mine]
    views.sort(key=lambda v: v["lastAtMs"], reverse=True)
    return views


class NewDm(BaseModel):
    me: str
    peerUserId: str


@app.post("/api/conversations")
async def create_dm(req: NewDm) -> dict:
    require_user(req.me)
    require_user(req.peerUserId)
    pair = {req.me, req.peerUserId}
    # create-or-get: reuse an existing DM between the same two people
    for c in CONVERSATIONS:
        if c["type"] == "dm" and set(c["memberIds"]) == pair:
            return {"id": c["id"]}
    conv = {
        "id": new_id(),
        "type": "dm",
        "name": None,
        "memberIds": [req.me, req.peerUserId],
        "createdBy": req.me,
    }
    CONVERSATIONS.append(conv)
    return {"id": conv["id"]}


class NewGroup(BaseModel):
    me: str
    name: str
    memberIds: list[str]


@app.post("/api/groups")
async def create_group(req: NewGroup) -> dict:
    require_user(req.me)
    members = list({req.me, *req.memberIds})
    conv = {
        "id": new_id(),
        "type": "group",
        "name": req.name.strip() or "New Group",
        "memberIds": members,
        "createdBy": req.me,
    }
    CONVERSATIONS.append(conv)
    return {"id": conv["id"]}


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


@app.get("/api/messages")
async def list_messages(conversationId: str, after: int = 0) -> list[dict]:
    return [
        m
        for m in MESSAGES
        if m["conversationId"] == conversationId and m["createdAtMs"] > after
    ]


class NewMessage(BaseModel):
    me: str
    conversationId: str
    body: Optional[str] = None
    attachment: Optional[dict] = None


@app.post("/api/messages")
async def send_message(req: NewMessage) -> dict:
    require_user(req.me)
    if not req.body and not req.attachment:
        raise HTTPException(status_code=400, detail="empty message")
    msg = {
        "id": new_id(),
        "conversationId": req.conversationId,
        "senderId": req.me,
        "body": req.body,
        "attachment": req.attachment,
        "createdAtMs": now_ms(),
    }
    MESSAGES.append(msg)
    return msg


# ---------------------------------------------------------------------------
# Typing indicator
# ---------------------------------------------------------------------------


class Typing(BaseModel):
    me: str
    conversationId: str


@app.post("/api/typing")
async def set_typing(req: Typing) -> dict:
    require_user(req.me)
    TYPING[(req.conversationId, req.me)] = now_ms()
    return {"ok": True}


@app.get("/api/typing")
async def get_typing(conversationId: str, me: str) -> list[dict]:
    cutoff = now_ms() - 4000
    out = []
    for (conv_id, user_id), ts in TYPING.items():
        if conv_id == conversationId and user_id != me and ts > cutoff:
            out.append({"userId": user_id, "displayName": USERS[user_id]["displayName"]})
    return out


# ---------------------------------------------------------------------------
# Terminals (shared)
# ---------------------------------------------------------------------------


class NewTerminal(BaseModel):
    me: str
    name: Optional[str] = None
    conversationId: Optional[str] = None


@app.post("/api/terminals")
async def create_terminal(req: NewTerminal) -> dict:
    require_user(req.me)
    # Create-or-get: one shared terminal per conversation. If this conversation
    # already has one, return it instead of spawning a second shell.
    if req.conversationId and req.conversationId in CONVERSATION_TERMINALS:
        tid = CONVERSATION_TERMINALS[req.conversationId]
        return {"id": tid, "name": TERMINALS[tid]["name"], "isNew": False}
    tid = new_id()
    term = {
        "id": tid,
        "name": req.name or "Shared terminal",
        "createdBy": req.me,
        "createdAtMs": now_ms(),
    }
    TERMINALS[tid] = term
    if req.conversationId:
        CONVERSATION_TERMINALS[req.conversationId] = tid
    register_terminal(tid)
    return {"id": tid, "name": term["name"], "isNew": True}


app.add_api_websocket_route("/ws/terminal/{terminal_id}", terminal_websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)

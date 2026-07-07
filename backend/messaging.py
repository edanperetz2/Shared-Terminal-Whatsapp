"""Groups + messages: REST endpoints and the live-messages WebSocket.

Message model: a row targets EITHER a group (group_id) OR a user (recipient_id).
New messages are persisted via REST, then pushed to every connected recipient
socket over /api/ws.
"""

import datetime as dt
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, StringConstraints

from db import execute, fetch_all, fetch_one
from realtime import broadcast, manager
from security import UserOut, decode_token, get_current_user, user_from_id

router = APIRouter(prefix="/api", tags=["messaging"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
GroupName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
Body = Annotated[str, StringConstraints(min_length=1, max_length=4000)]


# ---------------------------------------------------------------- models -----
class GroupCreate(BaseModel):
    name: GroupName
    member_ids: list[str] = []


class MemberOut(BaseModel):
    id: str
    username: str


class GroupOut(BaseModel):
    id: str
    name: str
    created_by: str
    created_at: dt.datetime
    members: list[MemberOut]


class MessageCreate(BaseModel):
    body: Body | None = None
    attachment_id: str | None = None


class AttachmentInfo(BaseModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int


class MessageOut(BaseModel):
    id: str
    sender_id: str
    sender_username: str
    group_id: str | None
    recipient_id: str | None
    body: str | None
    attachment: AttachmentInfo | None = None
    created_at: dt.datetime


# --------------------------------------------------------------- helpers -----
def _members(group_id: str) -> list[MemberOut]:
    rows = fetch_all(
        "select u.id, u.username from group_members gm "
        "join users u on u.id = gm.user_id where gm.group_id = %s order by u.username",
        (group_id,),
    )
    return [MemberOut(id=str(r["id"]), username=r["username"]) for r in rows]


def _member_ids(group_id: str) -> list[str]:
    rows = fetch_all("select user_id from group_members where group_id = %s", (group_id,))
    return [str(r["user_id"]) for r in rows]


def _is_member(group_id: str, user_id: str) -> bool:
    return (
        fetch_one(
            "select 1 from group_members where group_id = %s and user_id = %s",
            (group_id, user_id),
        )
        is not None
    )


def _group_out(row: dict) -> GroupOut:
    gid = str(row["id"])
    return GroupOut(
        id=gid,
        name=row["name"],
        created_by=str(row["created_by"]),
        created_at=row["created_at"],
        members=_members(gid),
    )


# Shared SELECT for messages: sender username + optional attachment.
_MSG_SELECT = (
    "select m.id, m.sender_id, m.group_id, m.recipient_id, m.body, m.created_at, "
    "u.username as sender_username, "
    "a.id as att_id, a.filename as att_filename, a.mime_type as att_mime, a.size_bytes as att_size "
    "from messages m join users u on u.id = m.sender_id "
    "left join attachments a on a.id = m.attachment_id"
)


def _msg_out(row: dict) -> MessageOut:
    attachment = None
    if row.get("att_id"):
        attachment = AttachmentInfo(
            id=str(row["att_id"]),
            filename=row["att_filename"],
            mime_type=row["att_mime"],
            size_bytes=row["att_size"],
        )
    return MessageOut(
        id=str(row["id"]),
        sender_id=str(row["sender_id"]),
        sender_username=row["sender_username"],
        group_id=str(row["group_id"]) if row["group_id"] else None,
        recipient_id=str(row["recipient_id"]) if row["recipient_id"] else None,
        body=row["body"],
        attachment=attachment,
        created_at=row["created_at"],
    )


def _fetch_message(message_id: str) -> MessageOut:
    return _msg_out(fetch_one(f"{_MSG_SELECT} where m.id = %s", (message_id,)))


def _validate_attachment(attachment_id: str | None, user_id: str) -> None:
    """An attachment must exist and belong to the sender."""
    if attachment_id is None:
        return
    row = fetch_one("select uploader_id from attachments where id = %s", (attachment_id,))
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Attachment not found")
    if str(row["uploader_id"]) != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your attachment")


def _require_content(body: MessageCreate) -> None:
    if not body.body and not body.attachment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message needs text or an image")


def _push(user_ids: list[str], msg: MessageOut) -> None:
    broadcast(user_ids, {"type": "message", "message": msg.model_dump(mode="json")})


# ---------------------------------------------------------------- groups -----
@router.post("/groups", response_model=GroupOut)
def create_group(body: GroupCreate, user: CurrentUser):
    row = fetch_one(
        "insert into groups (name, created_by) values (%s, %s) "
        "returning id, name, created_by, created_at",
        (body.name, user.id),
    )
    gid = str(row["id"])
    wanted = set(body.member_ids) | {user.id}
    # keep only ids that are real users (avoids FK errors on bad input)
    valid = fetch_all("select id from users where id::text = any(%s)", (list(wanted),))
    for r in valid:
        execute(
            "insert into group_members (group_id, user_id) values (%s, %s) "
            "on conflict do nothing",
            (gid, str(r["id"])),
        )
    return _group_out(row)


@router.get("/groups", response_model=list[GroupOut])
def list_groups(user: CurrentUser):
    rows = fetch_all(
        "select g.id, g.name, g.created_by, g.created_at from groups g "
        "join group_members gm on gm.group_id = g.id where gm.user_id = %s "
        "order by g.created_at desc",
        (user.id,),
    )
    return [_group_out(r) for r in rows]


@router.get("/groups/{group_id}", response_model=GroupOut)
def get_group(group_id: str, user: CurrentUser):
    if not _is_member(group_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    row = fetch_one(
        "select id, name, created_by, created_at from groups where id = %s", (group_id,)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return _group_out(row)


# -------------------------------------------------------------- messages -----
@router.get("/messages/dm/{other_id}", response_model=list[MessageOut])
def list_dm(other_id: str, user: CurrentUser):
    rows = fetch_all(
        f"{_MSG_SELECT} where m.group_id is null and ("
        "  (m.sender_id = %s and m.recipient_id = %s) or "
        "  (m.sender_id = %s and m.recipient_id = %s)) "
        "order by m.created_at",
        (user.id, other_id, other_id, user.id),
    )
    return [_msg_out(r) for r in rows]


@router.post("/messages/dm/{other_id}", response_model=MessageOut)
def send_dm(other_id: str, body: MessageCreate, user: CurrentUser):
    if user_from_id(other_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    _require_content(body)
    _validate_attachment(body.attachment_id, user.id)
    row = fetch_one(
        "insert into messages (sender_id, recipient_id, body, attachment_id) "
        "values (%s, %s, %s, %s) returning id",
        (user.id, other_id, body.body, body.attachment_id),
    )
    msg = _fetch_message(str(row["id"]))
    _push([msg.sender_id, other_id], msg)
    return msg


@router.get("/messages/group/{group_id}", response_model=list[MessageOut])
def list_group_messages(group_id: str, user: CurrentUser):
    if not _is_member(group_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    rows = fetch_all(
        f"{_MSG_SELECT} where m.group_id = %s order by m.created_at",
        (group_id,),
    )
    return [_msg_out(r) for r in rows]


@router.post("/messages/group/{group_id}", response_model=MessageOut)
def send_group_message(group_id: str, body: MessageCreate, user: CurrentUser):
    if not _is_member(group_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    _require_content(body)
    _validate_attachment(body.attachment_id, user.id)
    row = fetch_one(
        "insert into messages (sender_id, group_id, body, attachment_id) "
        "values (%s, %s, %s, %s) returning id",
        (user.id, group_id, body.body, body.attachment_id),
    )
    msg = _fetch_message(str(row["id"]))
    _push(_member_ids(group_id), msg)
    return msg


# ------------------------------------------------------------- websocket -----
@router.websocket("/ws")
async def ws_messages(ws: WebSocket, token: str = Query(...)):
    """Live delivery: authenticate via ?token=, then receive pushed messages.
    Inbound frames are ignored (used only as a keepalive)."""
    user_id = decode_token(token)
    if user_id is None or user_from_id(user_id) is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await ws.accept()
    if await manager.connect(user_id, ws):
        await manager.broadcast_all(
            {"type": "presence", "user_id": user_id, "online": True, "last_seen": None}
        )
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if await manager.disconnect(user_id, ws):
            row = fetch_one(
                "update users set last_seen = now() where id = %s returning last_seen",
                (user_id,),
            )
            last_seen = row["last_seen"].isoformat() if row and row["last_seen"] else None
            await manager.broadcast_all(
                {"type": "presence", "user_id": user_id, "online": False, "last_seen": last_seen}
            )

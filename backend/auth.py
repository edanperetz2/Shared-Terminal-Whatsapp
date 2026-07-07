"""Auth + user-directory routes: signup, login, logout, me, and the contacts
list (every other user). All under /api."""

import datetime as dt
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, StringConstraints

from db import fetch_all, fetch_one
from realtime import online_user_ids
from security import (
    UserOut,
    create_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api", tags=["auth"])

Username = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=32)]
Password = Annotated[str, StringConstraints(min_length=6, max_length=72)]


class Credentials(BaseModel):
    username: Username
    password: Password


class AuthResponse(BaseModel):
    token: str
    user: UserOut


def _user_out(row: dict) -> UserOut:
    return UserOut(id=str(row["id"]), username=row["username"], created_at=row["created_at"])


@router.post("/auth/signup", response_model=AuthResponse)
def signup(body: Credentials):
    try:
        row = fetch_one(
            "insert into users (username, password_hash) values (%s, %s) "
            "returning id, username, created_at",
            (body.username, hash_password(body.password)),
        )
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
    user = _user_out(row)
    return AuthResponse(token=create_token(user.id), user=user)


@router.post("/auth/login", response_model=AuthResponse)
def login(body: Credentials):
    row = fetch_one(
        "select id, username, password_hash, created_at from users where username = %s",
        (body.username,),
    )
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    user = _user_out(row)
    return AuthResponse(token=create_token(user.id), user=user)


@router.post("/auth/logout")
def logout(_: Annotated[UserOut, Depends(get_current_user)]):
    # Stateless JWT — the client discards the token. Endpoint exists so the
    # frontend has a symmetric call and we can validate the session.
    return {"ok": True}


@router.get("/auth/me", response_model=UserOut)
def me(user: Annotated[UserOut, Depends(get_current_user)]):
    return user


class ContactOut(BaseModel):
    id: str
    username: str
    created_at: dt.datetime
    online: bool
    last_seen: dt.datetime | None


@router.get("/users", response_model=list[ContactOut])
def list_users(user: Annotated[UserOut, Depends(get_current_user)]):
    """Contacts = every user other than the caller, with live presence."""
    online = online_user_ids()
    rows = fetch_all(
        "select id, username, created_at, last_seen from users where id <> %s order by username",
        (user.id,),
    )
    return [
        ContactOut(
            id=str(r["id"]),
            username=r["username"],
            created_at=r["created_at"],
            online=str(r["id"]) in online,
            last_seen=r["last_seen"],
        )
        for r in rows
    ]

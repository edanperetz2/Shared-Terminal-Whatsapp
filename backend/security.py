"""Auth primitives: password hashing (bcrypt), JWTs (PyJWT), and the
get_current_user FastAPI dependency. Tokens are stateless — logout is handled
client-side by discarding the token.
"""

import datetime as dt
import os

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from db import fetch_one

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "168"))
ALGORITHM = "HS256"

_bearer = HTTPBearer(auto_error=False)


class UserOut(BaseModel):
    id: str
    username: str
    created_at: dt.datetime


def hash_password(plain: str) -> str:
    # bcrypt operates on <=72 bytes; inputs are length-capped at the API layer.
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + dt.timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> str | None:
    """Return the user id from a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def user_from_id(user_id: str) -> UserOut | None:
    row = fetch_one(
        "select id, username, created_at from users where id = %s", (user_id,)
    )
    if not row:
        return None
    return UserOut(
        id=str(row["id"]), username=row["username"], created_at=row["created_at"]
    )


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserOut:
    """FastAPI dependency — resolves the Bearer token to the current user."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    user_id = decode_token(creds.credentials)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = user_from_id(user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user

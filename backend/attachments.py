"""Image attachments. Files are stored on the backend disk (backend/uploads/);
the attachments table indexes them. Upload is authenticated; download is gated
to the uploader or a participant of a message that references the file.
"""

import mimetypes
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from db import fetch_one
from security import UserOut, get_current_user

router = APIRouter(prefix="/api", tags=["attachments"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp"}


class AttachmentOut(BaseModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int


@router.post("/attachments", response_model=AttachmentOut)
async def upload(file: UploadFile, user: CurrentUser):
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only image uploads are allowed"
        )
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large (max 10 MB)")

    ext = mimetypes.guess_extension(file.content_type) or ""
    att_id = uuid.uuid4()
    path = UPLOAD_DIR / f"{att_id}{ext}"
    path.write_bytes(data)

    row = fetch_one(
        "insert into attachments (id, uploader_id, filename, mime_type, size_bytes, path) "
        "values (%s, %s, %s, %s, %s, %s) returning id, filename, mime_type, size_bytes",
        (str(att_id), user.id, file.filename or f"image{ext}", file.content_type, len(data), str(path)),
    )
    return AttachmentOut(
        id=str(row["id"]),
        filename=row["filename"],
        mime_type=row["mime_type"],
        size_bytes=row["size_bytes"],
    )


def _can_view(att_id: str, user_id: str) -> dict | None:
    """Return the attachment row if the user may view it, else None."""
    row = fetch_one(
        "select uploader_id, mime_type, path, filename from attachments where id = %s",
        (att_id,),
    )
    if row is None:
        return None
    if str(row["uploader_id"]) == user_id:
        return row
    seen = fetch_one(
        "select 1 from messages m where m.attachment_id = %s and ("
        "  m.recipient_id = %s or m.sender_id = %s or "
        "  (m.group_id is not null and exists ("
        "     select 1 from group_members gm where gm.group_id = m.group_id and gm.user_id = %s))"
        ") limit 1",
        (att_id, user_id, user_id, user_id),
    )
    return row if seen is not None else None


@router.get("/attachments/{att_id}")
def download(att_id: str, user: CurrentUser):
    row = _can_view(att_id, user.id)
    if row is None:
        # 404 whether it doesn't exist or the caller can't see it (don't leak).
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    path = Path(row["path"])
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing on disk")
    return FileResponse(path, media_type=row["mime_type"], filename=row["filename"])

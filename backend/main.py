"""FastAPI backend for the messaging app.

Run with: .venv/Scripts/uvicorn main:app --reload --port 8080  (Windows)
          .venv/bin/uvicorn  main:app --reload --port 8080  (POSIX)

In development the Next.js frontend proxies /api/* here (next.config.ts
rewrite), so browser code calls relative /api/... paths on port 3000.
Interactive docs: http://localhost:8080/docs
"""

import asyncio
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # must run before importing modules that read env at import time

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from attachments import router as attachments_router  # noqa: E402
from auth import router as auth_router  # noqa: E402
from db import pool  # noqa: E402
from messaging import router as messaging_router  # noqa: E402
from realtime import set_loop  # noqa: E402
from terminal import router as terminal_router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    set_loop(asyncio.get_running_loop())  # lets sync handlers schedule broadcasts
    try:
        yield
    finally:
        pool.close()


app = FastAPI(title="Messaging API", version="0.1.0", lifespan=lifespan)

# CORS for direct (non-proxied) calls from the dev frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    service: str


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check — also used by the landing-page status board."""
    return HealthResponse(status="ok", service="fastapi")


app.include_router(auth_router)
app.include_router(messaging_router)
app.include_router(terminal_router)
app.include_router(attachments_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)

"""In-memory WebSocket registry for live message delivery.

Maps user_id -> open sockets. REST handlers run in a threadpool (sync def), so
they hand broadcasts back to the event loop via run_coroutine_threadsafe.
Single-process only — fine for local dev / one backend instance.
"""

import asyncio

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, ws: WebSocket) -> bool:
        """Register a socket. Returns True if the user just came online."""
        async with self._lock:
            conns = self.active.setdefault(user_id, set())
            became_online = len(conns) == 0
            conns.add(ws)
            return became_online

    async def disconnect(self, user_id: str, ws: WebSocket) -> bool:
        """Remove a socket. Returns True if the user just went offline."""
        async with self._lock:
            conns = self.active.get(user_id)
            if not conns:
                return False
            conns.discard(ws)
            if not conns:
                self.active.pop(user_id, None)
                return True
            return False

    async def send_to_users(self, user_ids: list[str], payload: dict) -> None:
        async with self._lock:
            targets = [ws for uid in set(user_ids) for ws in self.active.get(uid, set())]
        await self._send(targets, payload)

    async def broadcast_all(self, payload: dict) -> None:
        async with self._lock:
            targets = [ws for conns in self.active.values() for ws in conns]
        await self._send(targets, payload)

    @staticmethod
    async def _send(targets: list[WebSocket], payload: dict) -> None:
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                pass  # socket died; disconnect handler will clean it up


def online_user_ids() -> set[str]:
    """Snapshot of users with at least one open socket."""
    return set(manager.active.keys())


manager = ConnectionManager()

_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def broadcast(user_ids: list[str], payload: dict) -> None:
    """Schedule a broadcast from sync (threadpool) code onto the event loop."""
    if _loop is None:
        return
    asyncio.run_coroutine_threadsafe(manager.send_to_users(user_ids, payload), _loop)

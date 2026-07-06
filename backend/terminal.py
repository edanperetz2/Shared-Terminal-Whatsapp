"""Shared terminal: one real PowerShell per terminal id, streamed to everyone.

A "PTY" (pseudo-terminal) is a real shell the backend drives. For each terminal
id we spawn one PowerShell and keep a set of connected browsers. Whatever the
shell prints is broadcast to all of them; anything any of them types is written
back into the shell — so everyone shares one live session and all can type.
"""

import asyncio
import json
import threading
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

try:
    from winpty import PtyProcess  # from the pywinpty package (Windows)

    _HAVE_PTY = True
except Exception:  # pragma: no cover - only if pywinpty missing
    PtyProcess = None
    _HAVE_PTY = False

RING_MAX = 16000  # chars of recent output replayed to someone who joins late


class TerminalSession:
    def __init__(self, terminal_id: str) -> None:
        self.id = terminal_id
        self.proc = None
        self.clients: set[WebSocket] = set()
        self.buffer = ""  # recent output ("last screenful") for late joiners
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def ensure_started(self, loop: asyncio.AbstractEventLoop) -> None:
        if self.proc is not None:
            return
        self.loop = loop
        self.proc = PtyProcess.spawn(["powershell.exe", "-NoLogo"])
        threading.Thread(target=self._read_loop, daemon=True).start()

    def _read_loop(self) -> None:
        while True:
            try:
                data = self.proc.read(4096)
            except Exception:
                break
            if not data:
                break
            self.buffer = (self.buffer + data)[-RING_MAX:]
            if self.loop:
                asyncio.run_coroutine_threadsafe(self._broadcast(data), self.loop)

    async def _broadcast(self, data: str) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_text(data)
            except Exception:
                self.clients.discard(ws)


SESSIONS: dict[str, TerminalSession] = {}


def register_terminal(terminal_id: str) -> None:
    """Called when a terminal is created; the shell itself starts on first open."""
    SESSIONS.setdefault(terminal_id, TerminalSession(terminal_id))


async def terminal_websocket(websocket: WebSocket, terminal_id: str) -> None:
    await websocket.accept()
    if not _HAVE_PTY:
        await websocket.send_text("\r\n[terminal unavailable: pywinpty not installed]\r\n")
        await websocket.close()
        return

    session = SESSIONS.setdefault(terminal_id, TerminalSession(terminal_id))
    try:
        session.ensure_started(asyncio.get_running_loop())
    except Exception as exc:
        await websocket.send_text(f"\r\n[failed to start shell: {exc}]\r\n")
        await websocket.close()
        return

    session.clients.add(websocket)
    if session.buffer:  # replay recent output to a late joiner
        await websocket.send_text(session.buffer)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                session.proc.write(raw)
                continue
            if msg.get("type") == "input":
                session.proc.write(msg.get("data", ""))
            elif msg.get("type") == "resize":
                try:
                    session.proc.setwinsize(int(msg.get("rows", 24)), int(msg.get("cols", 80)))
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        session.clients.discard(websocket)

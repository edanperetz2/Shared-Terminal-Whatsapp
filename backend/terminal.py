"""Live shared terminal — one shell process per group, mirrored to every
connected group member.

WS protocol (JSON frames):
  client -> server: {"type":"input","data":"..."} | {"type":"resize","rows":R,"cols":C}
  server -> client: {"type":"output","data":"..."} | {"type":"exit"}

A blocking OS pseudo-terminal is read on a background thread; output is pushed
onto the event loop and fanned out to all sockets. The session is created
lazily on first connect and killed when the last member disconnects. A small
scrollback buffer is replayed to late joiners so everyone sees the same screen.
"""

import asyncio
import json
import os
import sys
import threading

from fastapi import (
    APIRouter,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)

from messaging import _is_member
from security import decode_token, user_from_id

IS_WINDOWS = sys.platform == "win32"
_SCROLLBACK = 20000  # chars of recent output replayed to new members


class PtyBackend:
    """OS pseudo-terminal running an interactive shell (winpty / posix pty)."""

    def __init__(self, rows: int = 24, cols: int = 80) -> None:
        if IS_WINDOWS:
            import winpty

            shell = os.environ.get("COMSPEC", "cmd.exe")
            self._p = winpty.PtyProcess.spawn(shell, dimensions=(rows, cols))
        else:
            import pty
            import subprocess

            self._master, slave = pty.openpty()
            shell = os.environ.get("SHELL", "/bin/bash")
            self._proc = subprocess.Popen(
                [shell],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                preexec_fn=os.setsid,
                close_fds=True,
            )
            os.close(slave)

    def read(self) -> str:
        """Block until output is available; return "" on EOF/exit."""
        if IS_WINDOWS:
            try:
                return self._p.read(1024)
            except EOFError:
                return ""
        try:
            return os.read(self._master, 1024).decode(errors="replace")
        except OSError:
            return ""

    def write(self, data: str) -> None:
        try:
            if IS_WINDOWS:
                self._p.write(data)
            else:
                os.write(self._master, data.encode())
        except (OSError, EOFError):
            pass

    def resize(self, rows: int, cols: int) -> None:
        try:
            if IS_WINDOWS:
                self._p.setwinsize(rows, cols)
            else:
                import fcntl
                import struct
                import termios

                fcntl.ioctl(
                    self._master,
                    termios.TIOCSWINSZ,
                    struct.pack("HHHH", rows, cols, 0, 0),
                )
        except Exception:
            pass

    def alive(self) -> bool:
        if IS_WINDOWS:
            return self._p.isalive()
        return self._proc.poll() is None

    def kill(self) -> None:
        try:
            if IS_WINDOWS:
                self._p.terminate(force=True)
            else:
                self._proc.terminate()
        except Exception:
            pass


class TerminalSession:
    def __init__(self, group_id: str, loop: asyncio.AbstractEventLoop) -> None:
        self.group_id = group_id
        self.loop = loop
        self.pty = PtyBackend()
        self.clients: set[WebSocket] = set()
        self.buffer = ""
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        while True:
            data = self.pty.read()
            if data == "":
                asyncio.run_coroutine_threadsafe(self._fanout({"type": "exit"}), self.loop)
                break
            self.buffer = (self.buffer + data)[-_SCROLLBACK:]
            asyncio.run_coroutine_threadsafe(
                self._fanout({"type": "output", "data": data}), self.loop
            )

    async def _fanout(self, payload: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def send_backlog(self, ws: WebSocket) -> None:
        if self.buffer:
            await ws.send_json({"type": "output", "data": self.buffer})

    def add(self, ws: WebSocket) -> None:
        self.clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    def empty(self) -> bool:
        return not self.clients


class TerminalManager:
    def __init__(self) -> None:
        self.sessions: dict[str, TerminalSession] = {}
        self._lock = threading.Lock()

    def get_or_create(self, group_id: str, loop: asyncio.AbstractEventLoop) -> TerminalSession:
        with self._lock:
            sess = self.sessions.get(group_id)
            if sess is None or not sess.pty.alive():
                sess = TerminalSession(group_id, loop)
                self.sessions[group_id] = sess
            return sess

    def close(self, group_id: str) -> None:
        with self._lock:
            sess = self.sessions.pop(group_id, None)
        if sess:
            sess.pty.kill()


terminals = TerminalManager()

router = APIRouter(prefix="/api", tags=["terminal"])


@router.websocket("/ws/terminal/{group_id}")
async def ws_terminal(ws: WebSocket, group_id: str, token: str = Query(...)):
    user_id = decode_token(token)
    if user_id is None or user_from_id(user_id) is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not _is_member(group_id, user_id):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    sess = terminals.get_or_create(group_id, asyncio.get_running_loop())
    sess.add(ws)
    await sess.send_backlog(ws)
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "input":
                sess.pty.write(msg.get("data", ""))
            elif msg.get("type") == "resize":
                sess.pty.resize(int(msg.get("rows", 24)), int(msg.get("cols", 80)))
    except WebSocketDisconnect:
        pass
    finally:
        sess.remove(ws)
        if sess.empty():
            terminals.close(group_id)

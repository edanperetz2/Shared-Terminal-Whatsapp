"use client";

// The black terminal screen. It is docked at the BOTTOM of the open chat (it does
// not cover the messages). Draws an xterm screen and connects to the backend's
// shared shell over a WebSocket: your keystrokes go to the shell, and everything
// the shell prints (including what other people type) shows up here.

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { WS_BASE } from "@/lib/api";

export function TerminalView({
  terminalId,
  name,
  onClose,
}: {
  terminalId: string;
  name: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let ws: WebSocket | undefined;
    let onResize: (() => void) | undefined;

    (async () => {
      // Load xterm only in the browser (it needs the DOM to draw).
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        theme: { background: "#0b141a" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      ws = new WebSocket(`${WS_BASE}/ws/terminal/${terminalId}`);
      ws.onopen = () =>
        ws?.send(JSON.stringify({ type: "resize", cols: term!.cols, rows: term!.rows }));
      ws.onmessage = (e) => term?.write(e.data);
      ws.onclose = () => term?.write("\r\n\x1b[31m[disconnected]\x1b[0m\r\n");

      // Send my keystrokes to the shared shell.
      term.onData((d) => {
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "input", data: d }));
      });

      onResize = () => {
        try {
          fit.fit();
          if (ws && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "resize", cols: term!.cols, rows: term!.rows }));
        } catch {}
      };
      window.addEventListener("resize", onResize);
    })();

    return () => {
      disposed = true;
      if (onResize) window.removeEventListener("resize", onResize);
      try {
        ws?.close();
      } catch {}
      try {
        term?.dispose();
      } catch {}
    };
  }, [terminalId]);

  return (
    <div className="flex h-72 shrink-0 flex-col border-t bg-[#0b141a]">
      <div className="flex items-center justify-between bg-zinc-900 px-4 py-2 text-sm text-white">
        <span>🖥️ {name} — shared terminal (everyone here can type)</span>
        <button
          onClick={onClose}
          className="rounded px-2 py-0.5 hover:bg-zinc-700"
          aria-label="Close terminal"
        >
          ✕
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}

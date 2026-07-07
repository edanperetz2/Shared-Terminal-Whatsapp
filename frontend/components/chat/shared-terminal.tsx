"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

import { getToken } from "@/lib/api";
import { wsUrl } from "@/lib/ws";

// The group's live shared terminal. Renders the shell with xterm.js and wires
// it to WS /api/ws/terminal/{groupId}: server "output" -> screen, local
// keystrokes -> server "input", container resize -> server "resize".
export function SharedTerminal({ groupId }: { groupId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const token = getToken();
    if (!container || !token) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: { background: "#0b0b0e", foreground: "#e6e6e6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    const ws = new WebSocket(wsUrl(`/api/ws/terminal/${groupId}`, token));

    const sendResize = () => {
      try {
        fit.fit();
      } catch {
        /* container may be detached mid-teardown */
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", rows: term.rows, cols: term.cols }));
      }
    };

    ws.onopen = () => {
      sendResize();
      term.focus();
    };
    ws.onmessage = (ev) => {
      let msg: { type?: string; data?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "output" && msg.data) term.write(msg.data);
      else if (msg.type === "exit") term.write("\r\n\x1b[90m[shell exited]\x1b[0m\r\n");
    };
    ws.onclose = () => term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: d }));
      }
    });

    const resizeObs = new ResizeObserver(() => sendResize());
    resizeObs.observe(container);

    return () => {
      resizeObs.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [groupId]);

  return <div ref={containerRef} className="h-full w-full bg-[#0b0b0e] p-2" />;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api, getToken, type Group, type Message, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { wsUrl } from "@/lib/ws";
import { ConversationView } from "./conversation-view";
import { Sidebar } from "./sidebar";
import { type Selection } from "./types";

function belongsToSelection(msg: Message, sel: Selection, meId: string): boolean {
  if (sel.kind === "group") return msg.group_id === sel.group.id;
  return (
    msg.group_id === null &&
    ((msg.sender_id === meId && msg.recipient_id === sel.user.id) ||
      (msg.sender_id === sel.user.id && msg.recipient_id === meId))
  );
}

export function ChatApp({ user }: { user: User }) {
  const { logout } = useAuth();
  const [contacts, setContacts] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Keep the latest selection readable inside the long-lived WS callback.
  const selectionRef = useRef<Selection | null>(null);
  selectionRef.current = selection;

  const appendUnique = useCallback((msg: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  const loadLists = useCallback(async () => {
    const [u, g] = await Promise.all([api.users(), api.groups()]);
    setContacts(u);
    setGroups(g);
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  // Load history when the open conversation changes.
  useEffect(() => {
    if (!selection) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const p =
      selection.kind === "dm"
        ? api.dmMessages(selection.user.id)
        : api.groupMessages(selection.group.id);
    p.then((m) => !cancelled && setMessages(m)).catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [selection]);

  // Live message delivery — one socket for the whole session, auto-reconnect.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      ws = new WebSocket(wsUrl("/api/ws", token));
      ws.onmessage = (ev) => {
        let evt: {
          type?: string;
          message?: Message;
          user_id?: string;
          online?: boolean;
          last_seen?: string | null;
        };
        try {
          evt = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (evt.type === "presence" && evt.user_id) {
          setContacts((prev) =>
            prev.map((c) =>
              c.id === evt.user_id
                ? { ...c, online: evt.online, last_seen: evt.last_seen ?? c.last_seen }
                : c,
            ),
          );
          return;
        }
        if (evt.type !== "message" || !evt.message) return;
        const sel = selectionRef.current;
        if (sel && belongsToSelection(evt.message, sel, user.id)) appendUnique(evt.message);
      };
      ws.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 1000);
      };
    };
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [user.id, appendUnique]);

  const send = useCallback(
    async (body: string, attachmentId?: string | null) => {
      const sel = selectionRef.current;
      if (!sel) return;
      const msg =
        sel.kind === "dm"
          ? await api.sendDm(sel.user.id, body, attachmentId)
          : await api.sendGroup(sel.group.id, body, attachmentId);
      appendUnique(msg);
    },
    [appendUnique],
  );

  const createGroup = useCallback(
    async (name: string, memberIds: string[]) => {
      const g = await api.createGroup(name, memberIds);
      await loadLists();
      setSelection({ kind: "group", group: g });
    },
    [loadLists],
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">Messenger</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.username}</span>
          </span>
          <Button variant="outline" size="sm" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          contacts={contacts}
          groups={groups}
          selection={selection}
          onSelect={setSelection}
          onCreateGroup={createGroup}
        />
        <ConversationView
          me={user}
          selection={selection}
          messages={messages}
          onSend={send}
          peer={
            selection?.kind === "dm"
              ? (contacts.find((c) => c.id === selection.user.id) ?? selection.user)
              : null
          }
        />
      </div>
    </div>
  );
}

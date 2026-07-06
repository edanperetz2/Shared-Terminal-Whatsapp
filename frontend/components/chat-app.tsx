"use client";

// The whole WhatsApp+ screen: sidebar (who am I, chats, new chat/group) on the
// left, the open conversation on the right (messages, typing line, message box
// with photo + terminal buttons), and the shared terminal docked at the bottom.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TerminalView } from "@/components/terminal-view";
import {
  api,
  getMe,
  type Conversation,
  type Message,
  type User,
} from "@/lib/api";

export function ChatApp() {
  const [me, setMe] = useState("alice");
  const [users, setUsers] = useState<User[]>([]);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingText, setTypingText] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [openTerminal, setOpenTerminal] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [modal, setModal] = useState<null | "dm" | "group">(null);

  const cursorRef = useRef(0);
  const lastTypingSentRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const nameOf = useCallback(
    (id: string) => users.find((u) => u.id === id)?.displayName ?? id,
    [users],
  );

  // Load current user + reference data once.
  useEffect(() => {
    setMe(getMe());
    api.users().then(setUsers).catch(() => {});
  }, []);

  // Poll the chat list every 3s so new chats / last messages stay fresh.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = () =>
      api
        .conversations(me)
        .then((c) => alive && setConvos(c))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [me]);

  const active = convos.find((c) => c.id === activeId) ?? null;

  // When you open a chat: reset, then poll its messages + typing every 2s.
  useEffect(() => {
    if (!activeId) return;
    cursorRef.current = 0;
    setMessages([]);
    setTypingText("");
    let alive = true;

    const pollMessages = () =>
      api.messages(activeId, cursorRef.current).then((incoming) => {
        if (!alive || incoming.length === 0) return;
        cursorRef.current = Math.max(...incoming.map((m) => m.createdAtMs));
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
        });
      }).catch(() => {});

    const pollTyping = () =>
      api.getTyping(activeId, me).then((list) => {
        if (!alive) return;
        setTypingText(
          list.length ? `${list.map((t) => t.displayName).join(", ")} typing…` : "",
        );
      }).catch(() => {});

    pollMessages();
    pollTyping();
    const t1 = setInterval(pollMessages, 2000);
    const t2 = setInterval(pollTyping, 2000);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [activeId, me]);

  // Keep the message list scrolled to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, openTerminal]);

  function onDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    if (activeId && now - lastTypingSentRef.current > 1500) {
      lastTypingSentRef.current = now;
      api.setTyping(me, activeId).catch(() => {});
    }
  }

  function appendLocal(msg: Message) {
    cursorRef.current = Math.max(cursorRef.current, msg.createdAtMs);
    setMessages((prev) =>
      prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
    );
  }

  async function sendText() {
    if (!activeId || (!draft.trim() && !pendingPhoto)) return;
    const payload = {
      me,
      conversationId: activeId,
      body: draft.trim() || null,
      attachment: pendingPhoto
        ? ({ kind: "photo", dataUrl: pendingPhoto } as const)
        : null,
    };
    setDraft("");
    setPendingPhoto(null);
    const msg = await api.sendMessage(payload).catch(() => null);
    if (msg) appendLocal(msg);
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Photo too large (max 2MB for this demo).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPendingPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function attachTerminal() {
    if (!activeId) return;
    const term = await api
      .createTerminal(me, "Shared terminal", activeId)
      .catch(() => null);
    if (!term) return;
    // Only drop a card into the chat the first time; otherwise reuse the shared one.
    if (term.isNew) {
      const msg = await api
        .sendMessage({
          me,
          conversationId: activeId,
          body: null,
          attachment: { kind: "terminal", terminalId: term.id, name: term.name },
        })
        .catch(() => null);
      if (msg) appendLocal(msg);
    }
    setOpenTerminal({ id: term.id, name: term.name });
  }

  function switchUser(id: string) {
    window.location.href = `${window.location.pathname}?me=${id}`;
  }

  return (
    <div className="flex h-screen w-full bg-white text-zinc-900">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r bg-zinc-50">
        <div className="border-b p-3">
          <label className="text-xs text-zinc-500">You are</label>
          <select
            className="mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm"
            value={me}
            onChange={(e) => switchUser(e.target.value)}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setModal("dm")}>
              New chat
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setModal("group")}>
              New group
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convos.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`flex w-full flex-col items-start border-b px-4 py-3 text-left hover:bg-zinc-100 ${
                c.id === activeId ? "bg-zinc-100" : ""
              }`}
            >
              <span className="font-medium">
                {c.type === "group" ? "👥 " : ""}
                {c.title}
              </span>
              <span className="line-clamp-1 text-xs text-zinc-500">
                {c.lastMessage || "No messages yet"}
              </span>
            </button>
          ))}
          {convos.length === 0 && (
            <p className="p-4 text-sm text-zinc-500">No chats yet.</p>
          )}
        </div>
      </aside>

      {/* Conversation */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-zinc-400">
            Pick a chat to start messaging
          </div>
        ) : (
          <>
            <header className="border-b px-4 py-3">
              <h2 className="font-semibold">
                {active.type === "group" ? "👥 " : ""}
                {active.title}
              </h2>
              {active.type === "group" && (
                <p className="text-xs text-zinc-500">
                  {active.memberIds.map(nameOf).join(", ")}
                </p>
              )}
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-4">
              {messages.map((m) => {
                const mine = m.senderId === me;
                const att = m.attachment;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        mine ? "bg-[#d9fdd3]" : "bg-white"
                      }`}
                    >
                      {active.type === "group" && !mine && (
                        <div className="mb-0.5 text-xs font-semibold text-emerald-700">
                          {nameOf(m.senderId)}
                        </div>
                      )}
                      {att?.kind === "photo" && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.dataUrl}
                          alt="photo"
                          className="mb-1 max-h-60 rounded"
                        />
                      )}
                      {att?.kind === "terminal" && (
                        <button
                          onClick={() =>
                            setOpenTerminal({ id: att.terminalId, name: att.name })
                          }
                          className="mb-1 flex items-center gap-2 rounded bg-zinc-900 px-3 py-2 text-white"
                        >
                          🖥️ Open shared terminal
                        </button>
                      )}
                      {m.body && <div>{m.body}</div>}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className="h-5 px-4 text-xs italic text-zinc-500">{typingText}</div>

            {openTerminal && (
              <TerminalView
                terminalId={openTerminal.id}
                name={openTerminal.name}
                onClose={() => setOpenTerminal(null)}
              />
            )}

            <div className="flex items-center gap-2 border-t p-3">
              {pendingPhoto && (
                <span className="flex items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs">
                  📷 photo
                  <button onClick={() => setPendingPhoto(null)}>✕</button>
                </span>
              )}
              <label className="cursor-pointer rounded-md border px-2 py-1.5 text-sm hover:bg-zinc-100" title="Attach photo">
                📷
                <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
              </label>
              <button
                onClick={attachTerminal}
                className="rounded-md border px-2 py-1.5 text-sm hover:bg-zinc-100"
                title="Share a terminal"
              >
                {">_"}
              </button>
              <Input
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendText()}
                placeholder="Type a message"
              />
              <Button onClick={sendText}>Send</Button>
            </div>
          </>
        )}
      </main>

      {modal && (
        <NewChatModal
          kind={modal}
          me={me}
          users={users}
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null);
            setActiveId(id);
            api.conversations(me).then(setConvos).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

// Small popup for starting a private chat or creating a group.
function NewChatModal({
  kind,
  me,
  users,
  onClose,
  onCreated,
}: {
  kind: "dm" | "group";
  me: string;
  users: User[];
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const others = users.filter((u) => u.id !== me);
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function startDm(peerUserId: string) {
    const res = await api.createDm(me, peerUserId).catch(() => null);
    if (res) onCreated(res.id);
  }

  async function createGroup() {
    if (!groupName.trim() || selected.size === 0) return;
    const res = await api
      .createGroup(me, groupName.trim(), [...selected])
      .catch(() => null);
    if (res) onCreated(res.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold">
          {kind === "dm" ? "New chat" : "New group"}
        </h3>

        {kind === "dm" ? (
          <div className="space-y-1">
            {others.map((u) => (
              <button
                key={u.id}
                onClick={() => startDm(u.id)}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-zinc-100"
              >
                <span className="inline-block size-2.5 rounded-full" style={{ background: u.color }} />
                {u.displayName}
              </button>
            ))}
          </div>
        ) : (
          <>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="mb-3"
            />
            <div className="space-y-1">
              {others.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded px-3 py-2 hover:bg-zinc-100">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                  {u.displayName}
                </label>
              ))}
            </div>
            <Button className="mt-3 w-full" onClick={createGroup}>
              Create group
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

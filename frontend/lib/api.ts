// Small client-side helper: knows "who am I" (from the ?me= URL) and wraps the
// backend calls so the UI code stays short. No auth — identity is just the URL.

export type User = { id: string; displayName: string; color: string };
export type Conversation = {
  id: string;
  type: "dm" | "group";
  title: string;
  memberIds: string[];
  lastMessage: string;
  lastAtMs: number;
};
export type Attachment =
  | { kind: "photo"; dataUrl: string }
  | { kind: "terminal"; terminalId: string; name: string };
export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  attachment: Attachment | null;
  createdAtMs: number;
};

// The live terminal connects straight to the backend (WebSockets skip the proxy).
// Use 127.0.0.1 (IPv4), not "localhost": on Windows "localhost" may resolve to
// IPv6 (::1) where the backend isn't listening, so the terminal would silently fail.
export const WS_BASE = "ws://127.0.0.1:8080";

export function getMe(): string {
  if (typeof window === "undefined") return "alice";
  return new URLSearchParams(window.location.search).get("me") || "alice";
}

async function jget(path: string) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(path: string, body: unknown) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export const api = {
  users: (): Promise<User[]> => jget("/api/users"),
  conversations: (me: string): Promise<Conversation[]> =>
    jget(`/api/conversations?me=${me}`),
  createDm: (me: string, peerUserId: string): Promise<{ id: string }> =>
    jpost("/api/conversations", { me, peerUserId }),
  createGroup: (
    me: string,
    name: string,
    memberIds: string[],
  ): Promise<{ id: string }> => jpost("/api/groups", { me, name, memberIds }),
  messages: (conversationId: string, after: number): Promise<Message[]> =>
    jget(`/api/messages?conversationId=${conversationId}&after=${after}`),
  sendMessage: (payload: {
    me: string;
    conversationId: string;
    body?: string | null;
    attachment?: Attachment | null;
  }): Promise<Message> => jpost("/api/messages", payload),
  setTyping: (me: string, conversationId: string) =>
    jpost("/api/typing", { me, conversationId }),
  getTyping: (
    conversationId: string,
    me: string,
  ): Promise<{ userId: string; displayName: string }[]> =>
    jget(`/api/typing?conversationId=${conversationId}&me=${me}`),
  createTerminal: (
    me: string,
    name: string,
    conversationId: string,
  ): Promise<{ id: string; name: string; isNew: boolean }> =>
    jpost("/api/terminals", { me, name, conversationId }),
};

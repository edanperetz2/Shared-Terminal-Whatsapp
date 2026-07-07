// Typed client for the FastAPI backend. Always uses relative /api/* paths (the
// Next rewrite proxies them to the backend), and attaches the JWT from
// localStorage as a Bearer token.

export type User = {
  id: string;
  username: string;
  created_at: string;
  // Present on contacts (GET /api/users); absent on the auth'd self.
  online?: boolean;
  last_seen?: string | null;
};
export type Member = { id: string; username: string };
export type Group = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  members: Member[];
};
export type Attachment = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};
export type Message = {
  id: string;
  sender_id: string;
  sender_username: string;
  group_id: string | null;
  recipient_id: string | null;
  body: string | null;
  attachment: Attachment | null;
  created_at: string;
};
export type AuthResponse = { token: string; user: User };

const TOKEN_KEY = "auth_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      const detail = data?.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail.map((d) => d?.msg ?? "").join(", ");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export const api = {
  signup: (username: string, password: string) =>
    req<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => req<User>("/api/auth/me"),

  users: () => req<User[]>("/api/users"),

  groups: () => req<Group[]>("/api/groups"),
  createGroup: (name: string, member_ids: string[]) =>
    req<Group>("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name, member_ids }),
    }),

  dmMessages: (otherId: string) => req<Message[]>(`/api/messages/dm/${otherId}`),
  sendDm: (otherId: string, body: string | null, attachmentId?: string | null) =>
    req<Message>(`/api/messages/dm/${otherId}`, {
      method: "POST",
      body: JSON.stringify({ body: body || null, attachment_id: attachmentId ?? null }),
    }),
  groupMessages: (groupId: string) => req<Message[]>(`/api/messages/group/${groupId}`),
  sendGroup: (groupId: string, body: string | null, attachmentId?: string | null) =>
    req<Message>(`/api/messages/group/${groupId}`, {
      method: "POST",
      body: JSON.stringify({ body: body || null, attachment_id: attachmentId ?? null }),
    }),

  uploadImage: async (file: File): Promise<Attachment> => {
    const fd = new FormData();
    fd.append("file", file);
    const token = getToken();
    const res = await fetch("/api/attachments", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const d = await res.json();
        if (typeof d?.detail === "string") message = d.detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as Attachment;
  },
};

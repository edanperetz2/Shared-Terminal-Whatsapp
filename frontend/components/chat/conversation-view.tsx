"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError, type Attachment, type Message, type User } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AuthedImage } from "./authed-image";
import { type Selection } from "./types";

// xterm touches window/document, so load it client-only.
const SharedTerminal = dynamic(
  () => import("./shared-terminal").then((m) => m.SharedTerminal),
  { ssr: false },
);

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function presenceLabel(peer: User | null): string {
  if (!peer) return "Direct message";
  if (peer.online) return "online";
  if (peer.last_seen)
    return `last seen ${new Date(peer.last_seen).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  return "offline";
}

export function ConversationView({
  me,
  selection,
  messages,
  onSend,
  peer,
}: {
  me: User;
  selection: Selection | null;
  messages: Message[];
  onSend: (body: string, attachmentId?: string | null) => Promise<void>;
  peer?: User | null;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [pending, setPending] = useState<Attachment | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reset terminal toggle + pending image whenever the conversation changes.
  useEffect(() => {
    setShowTerminal(false);
    setPending(null);
    setUploadError(null);
  }, [selection]);

  useEffect(() => {
    if (!showTerminal) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showTerminal]);

  if (!selection) {
    return (
      <section className="grid flex-1 place-items-center text-muted-foreground">
        Select a contact or group to start chatting.
      </section>
    );
  }

  const isGroup = selection.kind === "group";
  const title = isGroup ? `# ${selection.group.name}` : selection.user.username;
  const subtitle = isGroup
    ? selection.group.members.map((m) => m.username).join(", ")
    : presenceLabel(peer ?? null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      setPending(await api.uploadImage(file));
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body && !pending) return;
    setSending(true);
    try {
      await onSend(body, pending?.id ?? null);
      setDraft("");
      setPending(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {isGroup && (
          <Button
            variant={showTerminal ? "default" : "outline"}
            size="sm"
            onClick={() => setShowTerminal((v) => !v)}
          >
            {showTerminal ? "Back to chat" : "Terminal"}
          </Button>
        )}
      </header>

      {isGroup && showTerminal ? (
        <div className="min-h-0 flex-1">
          <SharedTerminal groupId={selection.group.id} />
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="m-auto text-sm text-muted-foreground">No messages yet — say hi.</p>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === me.id;
              return (
                <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[70%] rounded-lg px-3 py-2 text-sm",
                      mine ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {!mine && isGroup && (
                      <span className="mb-0.5 block text-xs font-medium opacity-70">
                        {m.sender_username}
                      </span>
                    )}
                    {m.attachment && (
                      <div className={cn(m.body && "mb-1")}>
                        <AuthedImage id={m.attachment.id} alt={m.attachment.filename} />
                      </div>
                    )}
                    {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                  </div>
                  <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                    {timeOf(m.created_at)}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="border-t p-3">
            {(pending || uploading || uploadError) && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                {uploading && <span>Uploading image…</span>}
                {pending && (
                  <>
                    <span className="rounded bg-muted px-2 py-1">🖼 {pending.filename}</span>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => setPending(null)}
                    >
                      remove
                    </button>
                  </>
                )}
                {uploadError && <span className="text-destructive">{uploadError}</span>}
              </div>
            )}
            <form onSubmit={submit} className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Attach image"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                🖼
              </Button>
              <Input
                placeholder={`Message ${title}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={4000}
                autoFocus
              />
              <Button type="submit" disabled={sending || uploading || (!draft.trim() && !pending)}>
                Send
              </Button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Group, type User } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type Selection } from "./types";

function isActive(selection: Selection | null, kind: "dm" | "group", id: string): boolean {
  if (!selection || selection.kind !== kind) return false;
  return selection.kind === "dm" ? selection.user.id === id : selection.group.id === id;
}

export function Sidebar({
  contacts,
  groups,
  selection,
  onSelect,
  onCreateGroup,
}: {
  contacts: User[];
  groups: Group[];
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onCreateGroup: (name: string, memberIds: string[]) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    try {
      await onCreateGroup(name.trim(), [...picked]);
      setCreating(false);
      setName("");
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-72 flex-col border-r bg-muted/30">
      {/* Contacts */}
      <div className="px-3 pt-3 pb-1 pt-3">
        <h2 className="px-1 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contacts
        </h2>
        <ul className="flex flex-col gap-0.5">
          {contacts.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">No other users yet</li>
          )}
          {contacts.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => onSelect({ kind: "dm", user: u })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  isActive(selection, "dm", u.id) && "bg-accent font-medium",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-2 shrink-0 rounded-full",
                    u.online ? "bg-emerald-500" : "bg-zinc-400",
                  )}
                  title={u.online ? "online" : "offline"}
                />
                {u.username}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Groups */}
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Groups
        </h2>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "+ New"}
        </Button>
      </div>

      {creating && (
        <div className="mx-3 mt-1 grid gap-2 rounded-md border bg-background p-2">
          <Input
            placeholder="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
          />
          <div className="max-h-40 overflow-y-auto rounded-md border">
            {contacts.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">No users to add</p>
            )}
            {contacts.map((u) => (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={picked.has(u.id)}
                  onChange={() => toggle(u.id)}
                />
                {u.username}
              </label>
            ))}
          </div>
          <Button size="sm" disabled={busy || !name.trim() || picked.size === 0} onClick={submit}>
            {busy ? "Creating…" : `Create group (${picked.size})`}
          </Button>
        </div>
      )}

      <div className="mt-1 px-3 pb-3">
        <ul className="flex flex-col gap-0.5">
          {groups.length === 0 && !creating && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">No groups yet</li>
          )}
          {groups.map((g) => (
            <li key={g.id}>
              <button
                onClick={() => onSelect({ kind: "group", group: g })}
                className={cn(
                  "flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent",
                  isActive(selection, "group", g.id) && "bg-accent",
                )}
              >
                <span className={cn("text-sm", isActive(selection, "group", g.id) && "font-medium")}>
                  # {g.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {g.members.length} member{g.members.length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

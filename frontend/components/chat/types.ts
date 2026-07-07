import type { Group, User } from "@/lib/api";

// The currently open conversation: a direct message with a user, or a group.
export type Selection =
  | { kind: "dm"; user: User }
  | { kind: "group"; group: Group };

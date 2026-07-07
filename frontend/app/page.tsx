"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ChatApp } from "@/components/chat/chat-app";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Route guard: bounce to /login when not authenticated.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <ChatApp user={user} />;
}

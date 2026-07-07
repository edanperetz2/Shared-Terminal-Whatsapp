"use client";

import { useEffect, useState } from "react";

import { getToken } from "@/lib/api";

// Renders an attachment image by fetching it with the Bearer token and turning
// the bytes into an object URL — so the JWT is never placed in an <img src>.
export function AuthedImage({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const token = getToken();

    fetch(`/api/attachments/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (failed) return <span className="text-xs italic opacity-70">[image unavailable]</span>;
  if (!url) return <span className="text-xs italic opacity-70">loading image…</span>;

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt={alt}
      className="max-h-64 max-w-full rounded-md"
    />
  );
}

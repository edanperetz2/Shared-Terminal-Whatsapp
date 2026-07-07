// Same-origin WebSocket URLs. The Next dev rewrite (and prod BACKEND_URL proxy)
// forwards /api/* WebSocket upgrades to FastAPI, so we never hardcode the
// backend host — we derive it from the current page origin.

export function wsUrl(path: string, token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}?token=${encodeURIComponent(token)}`;
}

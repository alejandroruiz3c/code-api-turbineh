/**
 * Security Pack · the client address behind trusted proxies only (ADR-0054). X-Forwarded-For is a list anyone can
 * prepend to; only the entries appended by proxies the app trusts are real. TRUSTED_PROXY_HOPS says how many there are
 * (default 1 on Vercel, whose edge overwrites the header; otherwise 0: the header is never trusted).
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUSTED_PROXY_HOPS;
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
  }
  return env.VERCEL === "1" ? 1 : 0;
}

const IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,45})$/i;

/**
 * Client address for per-IP limits: the X-Forwarded-For entry added by the nearest trusted proxy (counted from the
 * right, so entries a client prepends are ignored). Without a trusted proxy every anonymous request shares the
 * "unknown" bucket rather than trusting a spoofable header.
 */
export function clientIp(h: Headers, hops: number = trustedProxyHops()): string {
  if (hops <= 0) return "unknown";
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[chain.length - hops] ?? (hops === 1 ? h.get("x-real-ip")?.trim() : undefined);
  return ip && IP.test(ip) ? ip : "unknown";
}

/**
 * Security Pack · fixed-window rate limiter (per key, in memory).
 * Single-instance only; replace with a shared store when running several instances.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit = 30, windowMs = 60_000, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}

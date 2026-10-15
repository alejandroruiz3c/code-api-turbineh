/**
 * Security Pack · fixed-window rate limiter shared by every instance of the app (ADR-0054). Counters live in the app's
 * own PostgreSQL (table rate_limits, src/db/component-security.ts): one row per key, reset when its window ends and
 * removed an hour later, so limits hold across instances, restarts and serverless cold starts. Unit tests
 * (NODE_ENV=test) and RATE_LIMIT_STORE=memory use an in-process store instead.
 *
 * Always `await rateLimit(…)`: without await the result is a Promise, which is always truthy (ESLint refuses it).
 */
export interface RateLimitStore {
  /** Counts one hit of `key` in its current window and returns the hits so far in that window. */
  hit(key: string, windowMs: number, now: number): Promise<number>;
}

/** In-process store: tests and single-process tools only (not shared between instances). */
export function memoryStore(): RateLimitStore {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async hit(key, windowMs, now) {
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (windows.size > 10_000)
          for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
        windows.set(key, { start: now, count: 1 });
        return 1;
      }
      w.count += 1;
      return w.count;
    },
  };
}

let calls = 0;

/** Shared store in the app's PostgreSQL: one atomic upsert per hit. */
export const postgresStore: RateLimitStore = {
  async hit(key, windowMs) {
    const [{ db }, { rateLimits }, { lt, sql }] = await Promise.all([
      import("@/db/client"),
      import("@/db/component-security"),
      import("drizzle-orm"),
    ]);
    const seconds = Math.max(1, Math.round(windowMs / 1000));
    const [row] = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: sql`now() + make_interval(secs => ${seconds})` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: sql`case when ${rateLimits.resetAt} <= now() then excluded.reset_at else ${rateLimits.resetAt} end`,
        },
      })
      .returning({ count: rateLimits.count });
    // Expired windows are removed now and then (TTL), so the table stays small.
    if (++calls % 200 === 0)
      await db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now() - interval '1 hour'`));
    return row?.count ?? 1;
  },
};

const memory = memoryStore();

function defaultStore(): RateLimitStore {
  return process.env.RATE_LIMIT_STORE === "memory" || process.env.NODE_ENV === "test"
    ? memory
    : postgresStore;
}

/** True while `key` has at most `limit` hits in the current window of `windowMs`; false once it is over. */
export async function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
  opts: { store?: RateLimitStore; now?: number } = {},
): Promise<boolean> {
  const count = await (opts.store ?? defaultStore()).hit(
    key.slice(0, 255),
    windowMs,
    opts.now ?? Date.now(),
  );
  return count <= limit;
}

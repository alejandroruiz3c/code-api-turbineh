/**
 * Retries of a failed publication (component social.publish.turbineh): exponential backoff with full jitter, the same
 * policy p-retry applies (factor 2, randomized), but spread across runner calls instead of inside one request, so a
 * serverless function never sleeps and a crash loses nothing: the next attempt time is stored on the post.
 * A wait the provider asked for (Retry-After, x-rate-limit-reset) wins when it is longer.
 */
export interface BackoffPolicy {
  /** First wait in milliseconds. */
  baseMs: number;
  /** Longest wait in milliseconds. */
  maxMs: number;
  factor: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 60_000, maxMs: 3_600_000, factor: 2 };

/** Wait before attempt `attempt + 1` after `attempt` failed attempts (1-based). `random` in [0, 1). */
export function backoffMs(
  attempt: number,
  opts: { policy?: BackoffPolicy; retryAfterMs?: number | null; random?: () => number } = {},
): number {
  const p = opts.policy ?? DEFAULT_BACKOFF;
  const ceiling = Math.min(p.maxMs, p.baseMs * p.factor ** Math.max(0, attempt - 1));
  // Full jitter between half the ceiling and the ceiling: concurrent failures do not retry in lockstep.
  const jittered = Math.round(ceiling / 2 + (ceiling / 2) * (opts.random ?? Math.random)());
  const asked = opts.retryAfterMs ?? 0;
  return Math.min(Math.max(jittered, asked), Math.max(p.maxMs, asked));
}

export type AttemptOutcome =
  { kind: "published" } | { kind: "retry"; at: Date } | { kind: "failed" };

/** What happens after an attempt failed: retried later while attempts remain and the error may pass, else failed. */
export function afterFailure(input: {
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  retryAfterMs?: number | null;
  now?: Date;
  random?: () => number;
}): AttemptOutcome {
  if (!input.retryable || input.attempt >= input.maxAttempts) return { kind: "failed" };
  const wait = backoffMs(input.attempt, {
    retryAfterMs: input.retryAfterMs ?? null,
    random: input.random,
  });
  return { kind: "retry", at: new Date((input.now ?? new Date()).getTime() + wait) };
}

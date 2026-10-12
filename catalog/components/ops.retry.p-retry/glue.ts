import pRetry, { AbortError } from "p-retry";

/** Throw this inside the operation for errors that must not be retried (validation, 4xx). */
export { AbortError };

/**
 * Retries a transient operation (network errors, rate limits) with exponential backoff and jitter. Bounded: at most
 * 10 retries whatever the caller asks; pass an AbortSignal to stop waiting when the request is cancelled.
 */
export function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { retries?: number; minTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  return pRetry(operation, {
    retries: Math.min(Math.max(options.retries ?? 3, 0), 10),
    minTimeout: options.minTimeoutMs ?? 200,
    factor: 2,
    randomize: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

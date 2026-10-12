import PQueue from "p-queue";

/**
 * In-process queue for batch work against rate-limited services (e.g. inference through the orchestrator):
 * at most `concurrency` at once and `perMinute` starts per minute. Not durable: use jobs.queue for work that must
 * survive restarts.
 */
export function createBatchQueue(opts: { concurrency: number; perMinute?: number }): PQueue {
  return new PQueue({
    concurrency: Math.max(1, opts.concurrency),
    ...(opts.perMinute ? { intervalCap: Math.max(1, opts.perMinute), interval: 60_000 } : {}),
  });
}

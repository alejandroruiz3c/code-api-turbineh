import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";

/**
 * Background jobs (component jobs.queue.turbineh). Define a job once, enqueue it from any server action, and let a
 * scheduler call POST /api/jobs/run (with JOBS_RUNNER_SECRET) every minute. Failed jobs retry with exponential
 * backoff; after maxAttempts they stay `failed` for inspection. Payloads are validated on enqueue and on run.
 *
 * Leases (ADR-0055): a claimed job holds a lease until `lease_until`, renewed by a heartbeat while the handler runs.
 * Every claim increments `lease_token` (the fencing token): completion, failure and heartbeats only apply while the
 * token still matches, so a runner whose lease expired can never overwrite the result of the runner that took over.
 * A `running` job whose lease expired (the runner crashed or was killed) is recovered by the next run: claimed again
 * while it has attempts left, otherwise marked `failed` with `LeaseExpired`.
 */
export type JobContext = {
  organizationId: string;
  /** Aborted when the lease is lost (another runner took the job over): stop work and side effects. */
  signal: AbortSignal;
};
type Handler = {
  schema: z.ZodType;
  run: (payload: unknown, ctx: JobContext) => Promise<void>;
};
const handlers = new Map<string, Handler>();

/** Lease length; the heartbeat renews it every third of it while the handler runs. */
export const LEASE_MS = 60_000;
export const HEARTBEAT_MS = LEASE_MS / 3;

export function defineJob<T>(
  type: string,
  schema: z.ZodType<T>,
  run: (payload: T, ctx: JobContext) => Promise<void>,
): void {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(type)) throw new Error(`invalid job type: ${type}`);
  handlers.set(type, { schema, run: (p, ctx) => run(schema.parse(p), ctx) });
}

export const isDefined = (type: string) => handlers.has(type);

export async function enqueue(
  type: string,
  payload: unknown,
  opts: { organizationId: string; runAt?: Date; maxAttempts?: number },
): Promise<string> {
  const handler = handlers.get(type);
  if (!handler) throw new Error(`unknown job type: ${type}`);
  const [row] = await db
    .insert(jobs)
    .values({
      organizationId: opts.organizationId,
      type,
      payload: handler.schema.parse(payload) as object,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: Math.min(Math.max(opts.maxAttempts ?? 5, 1), 20),
    })
    .returning({ id: jobs.id });
  return row?.id ?? "";
}

/** 30 s, 1 min, 2 min … capped at 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 3_600_000);
}

/** A job as the runner sees it after a claim. `token` is the fencing token of this claim. */
export type ClaimedJob = {
  id: string;
  type: string;
  payload: unknown;
  organizationId: string;
  attempts: number;
  maxAttempts: number;
  token: number;
};

/**
 * What the runner needs from storage. Every write is fenced by (id, token): it returns false when the lease was lost
 * (the job was reclaimed with a newer token or is no longer running), and then nothing is written.
 */
export interface JobStore {
  /** Fails stale jobs without attempts left, then claims due and stale jobs (new lease, token + 1). */
  claim(limit: number, leaseMs: number): Promise<ClaimedJob[]>;
  heartbeat(id: string, token: number, leaseMs: number): Promise<boolean>;
  complete(id: string, token: number): Promise<boolean>;
  fail(
    id: string,
    token: number,
    next: { status: "queued" | "failed"; runAt: Date; error: string },
  ): Promise<boolean>;
}

/** Recovery rule for a `running` job (also applied in SQL by the Postgres store). */
export function staleAction(
  job: { status: string; leaseUntil: Date | null; attempts: number; maxAttempts: number },
  now: Date,
): "none" | "reclaim" | "fail" {
  if (job.status !== "running" || !job.leaseUntil || job.leaseUntil > now) return "none";
  return job.attempts >= job.maxAttempts ? "fail" : "reclaim";
}

/** Postgres store: FOR UPDATE SKIP LOCKED claims (safe with several runners), fenced updates. */
export const postgresStore: JobStore = {
  async claim(limit, leaseMs) {
    await db.execute(sql`
      UPDATE jobs SET status = 'failed', last_error = 'LeaseExpired', lease_until = NULL, updated_at = now()
      WHERE status = 'running' AND lease_until < now() AND attempts >= max_attempts`);
    const claimed = await db.execute<{
      id: string;
      type: string;
      payload: unknown;
      organization_id: string;
      attempts: number;
      max_attempts: number;
      lease_token: number;
    }>(sql`
      UPDATE jobs SET status = 'running', locked_at = now(), heartbeat_at = now(),
        lease_until = now() + make_interval(secs => ${leaseMs / 1000}),
        lease_token = lease_token + 1, attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM jobs
        WHERE (status = 'queued' AND run_at <= now())
           OR (status = 'running' AND lease_until < now() AND attempts < max_attempts)
        ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
      )
      RETURNING id, type, payload, organization_id, attempts, max_attempts, lease_token`);
    return claimed.rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      organizationId: r.organization_id,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      token: r.lease_token,
    }));
  },
  async heartbeat(id, token, leaseMs) {
    const now = new Date();
    const rows = await db
      .update(jobs)
      .set({ heartbeatAt: now, leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now })
      .where(and(eq(jobs.id, id), eq(jobs.leaseToken, token), eq(jobs.status, "running")))
      .returning({ id: jobs.id });
    return rows.length > 0;
  },
  async complete(id, token) {
    const rows = await db
      .update(jobs)
      .set({ status: "done", lockedAt: null, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.leaseToken, token), eq(jobs.status, "running")))
      .returning({ id: jobs.id });
    return rows.length > 0;
  },
  async fail(id, token, next) {
    const rows = await db
      .update(jobs)
      .set({
        status: next.status,
        lockedAt: null,
        leaseUntil: null,
        runAt: next.runAt,
        lastError: next.error,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, id), eq(jobs.leaseToken, token), eq(jobs.status, "running")))
      .returning({ id: jobs.id });
    return rows.length > 0;
  },
};

export type RunSummary = { done: number; retried: number; failed: number; lost: number };

/**
 * Claims up to `limit` due jobs (and stale ones whose lease expired) and runs them, renewing each lease with a
 * heartbeat. `lost` counts jobs whose lease was taken over before they finished: their result is not written.
 */
export async function runDueJobs(
  limit = 10,
  opts: { store?: JobStore; leaseMs?: number; heartbeatMs?: number } = {},
): Promise<RunSummary> {
  const store = opts.store ?? postgresStore;
  const leaseMs = opts.leaseMs ?? LEASE_MS;
  const heartbeatMs = opts.heartbeatMs ?? Math.max(Math.floor(leaseMs / 3), 1);
  const take = Math.min(Math.max(limit, 1), 50);
  const claimed = await store.claim(take, leaseMs);
  const out: RunSummary = { done: 0, retried: 0, failed: 0, lost: 0 };
  for (const job of claimed) {
    const handler = handlers.get(job.type);
    const lease = new AbortController();
    const beat = setInterval(() => {
      store.heartbeat(job.id, job.token, leaseMs).then(
        (held) => {
          if (!held) lease.abort(new Error("LeaseLost"));
        },
        () => undefined,
      );
    }, heartbeatMs);
    let error: unknown = null;
    try {
      if (!handler) throw new Error("unknown job type");
      await handler.run(job.payload, { organizationId: job.organizationId, signal: lease.signal });
    } catch (err) {
      error = err;
    } finally {
      clearInterval(beat);
    }
    if (lease.signal.aborted) {
      out.lost++;
      continue;
    }
    if (error === null) {
      if (await store.complete(job.id, job.token)) out.done++;
      else out.lost++;
      continue;
    }
    const last = job.attempts >= job.maxAttempts;
    const written = await store.fail(job.id, job.token, {
      status: last ? "failed" : "queued",
      runAt: new Date(Date.now() + backoffMs(job.attempts)),
      // Only the error name is stored: messages may contain user data.
      error: error instanceof Error ? error.name.slice(0, 200) : "Error",
    });
    if (!written) out.lost++;
    else if (last) out.failed++;
    else out.retried++;
  }
  return out;
}

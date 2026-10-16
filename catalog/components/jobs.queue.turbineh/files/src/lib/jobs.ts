import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { jobEffects, jobs } from "@/db/schema";

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
 *
 * No duplicated side effects (ADR-0065), even when cron calls overlap (Vercel Cron every minute, a slow run still
 * going): claims use FOR UPDATE SKIP LOCKED, so two runners never take the same job; `enqueue(…, { idempotencyKey })`
 * makes repeated enqueues one job; and a handler wraps each external effect in `ctx.once(key, fn)`, recorded in
 * `job_effects` before it runs, so a retry or a runner that lost its lease never repeats it. `ctx.idempotencyKey(key)`
 * is the same key for providers that accept one (Stripe, Resend: `Idempotency-Key`).
 */
export type JobContext = {
  organizationId: string;
  /** Aborted when the lease is lost (another runner took the job over): stop work and side effects. */
  signal: AbortSignal;
  /** This job's id: stable across attempts and runners. */
  jobId: string;
  /**
   * Runs `fn` at most once per job and `key` (an email, a payment, a post): recorded before it runs, so a retry, an
   * overlapping run or a runner that lost its lease skips it (returns `{ ran: false }`). If `fn` throws, the record is
   * removed and a retry may run it again. A crash in the middle of `fn` leaves it recorded: at most once, never twice.
   */
  once: <T>(key: string, fn: () => Promise<T>) => Promise<{ ran: true; value: T } | { ran: false }>;
  /** `<jobId>:<key>` — pass it to providers that deduplicate requests (`Idempotency-Key` header). */
  idempotencyKey: (key: string) => string;
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

const EFFECT_KEY = /^[A-Za-z0-9._:-]{1,120}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:@/-]{1,200}$/;

/**
 * Enqueues a job. With `idempotencyKey`, the same (workspace, type, key) is one job: a second enqueue — an
 * overlapping cron call, a retried request, a double click — returns the existing job's id and adds nothing.
 */
export async function enqueue(
  type: string,
  payload: unknown,
  opts: { organizationId: string; runAt?: Date; maxAttempts?: number; idempotencyKey?: string },
): Promise<string> {
  const handler = handlers.get(type);
  if (!handler) throw new Error(`unknown job type: ${type}`);
  const key = opts.idempotencyKey;
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key))
    throw new Error("invalid idempotency key (1–200 letters, digits or ._:@/-)");
  const [row] = await db
    .insert(jobs)
    .values({
      organizationId: opts.organizationId,
      type,
      payload: handler.schema.parse(payload) as object,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: Math.min(Math.max(opts.maxAttempts ?? 5, 1), 20),
      ...(key ? { idempotencyKey: key } : {}),
    })
    .onConflictDoNothing({ target: [jobs.organizationId, jobs.type, jobs.idempotencyKey] })
    .returning({ id: jobs.id });
  if (row) return row.id;
  if (!key) return "";
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, opts.organizationId),
        eq(jobs.type, type),
        eq(jobs.idempotencyKey, key),
      ),
    );
  return existing?.id ?? "";
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
  /** Records effect `key` of job `id` before it runs; false when it was already recorded (it ran, or is running). */
  claimEffect(id: string, key: string): Promise<boolean>;
  /** Removes the record of an effect whose function threw, so a retry may run it. */
  releaseEffect(id: string, key: string): Promise<void>;
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
  async claimEffect(id, key) {
    const rows = await db
      .insert(jobEffects)
      .values({ jobId: id, key })
      .onConflictDoNothing()
      .returning({ key: jobEffects.key });
    return rows.length > 0;
  },
  async releaseEffect(id, key) {
    await db.delete(jobEffects).where(and(eq(jobEffects.jobId, id), eq(jobEffects.key, key)));
  },
};

/** The context a handler gets: the lease signal and at-most-once effects for this job (ADR-0065). */
export function jobContext(
  store: JobStore,
  job: Pick<ClaimedJob, "id" | "organizationId">,
  signal: AbortSignal,
): JobContext {
  return {
    organizationId: job.organizationId,
    signal,
    jobId: job.id,
    idempotencyKey: (key) => `${job.id}:${key}`,
    async once(key, fn) {
      if (!EFFECT_KEY.test(key))
        throw new Error("invalid effect key (1–120 letters, digits or ._:-)");
      // A runner that lost its lease stops before any new effect.
      if (signal.aborted) return { ran: false };
      if (!(await store.claimEffect(job.id, key))) return { ran: false };
      try {
        return { ran: true, value: await fn() };
      } catch (err) {
        await store.releaseEffect(job.id, key).catch(() => undefined);
        throw err;
      }
    },
  };
}

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
      await handler.run(job.payload, jobContext(store, job, lease.signal));
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

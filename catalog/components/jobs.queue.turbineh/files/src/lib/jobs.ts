import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";

/**
 * Background jobs (component jobs.queue.turbineh). Define a job once, enqueue it from any server action, and let a
 * scheduler call POST /api/jobs/run (with JOBS_RUNNER_SECRET) every minute. Failed jobs retry with exponential
 * backoff; after maxAttempts they stay `failed` for inspection. Payloads are validated on enqueue and on run.
 */
type Handler = {
  schema: z.ZodType;
  run: (payload: unknown, ctx: { organizationId: string }) => Promise<void>;
};
const handlers = new Map<string, Handler>();

export function defineJob<T>(
  type: string,
  schema: z.ZodType<T>,
  run: (payload: T, ctx: { organizationId: string }) => Promise<void>,
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

/** Claims up to `limit` due jobs atomically (safe with several runners) and runs them. */
export async function runDueJobs(
  limit = 10,
): Promise<{ done: number; retried: number; failed: number }> {
  const take = Math.min(Math.max(limit, 1), 50);
  const claimed = await db.execute<{
    id: string;
    type: string;
    payload: unknown;
    organization_id: string;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
      ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT ${take}
    )
    RETURNING id, type, payload, organization_id, attempts, max_attempts`);
  const out = { done: 0, retried: 0, failed: 0 };
  for (const job of claimed.rows) {
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error("unknown job type");
      await handler.run(job.payload, { organizationId: job.organization_id });
      await db
        .update(jobs)
        .set({ status: "done", lockedAt: null, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      out.done++;
    } catch (err) {
      const last = job.attempts >= job.max_attempts;
      await db
        .update(jobs)
        .set({
          status: last ? "failed" : "queued",
          lockedAt: null,
          runAt: new Date(Date.now() + backoffMs(job.attempts)),
          // Only the error name is stored: messages may contain user data.
          lastError: err instanceof Error ? err.name.slice(0, 200) : "Error",
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      if (last) out.failed++;
      else out.retried++;
    }
  }
  return out;
}

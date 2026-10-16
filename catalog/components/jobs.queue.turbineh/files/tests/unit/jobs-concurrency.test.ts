import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The real Postgres store (the same SQL the app runs) on PostgreSQL in WebAssembly: two runners at the same time, as
// when Vercel Cron calls /api/jobs/run every minute while the previous call is still running (ADR-0065).
vi.mock("@/db/client", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  return { client, db: drizzle(client) };
});

const { client } = (await import("@/db/client")) as unknown as { client: PGlite };
const { defineJob, enqueue, runDueJobs } = await import("@/lib/jobs");
const { z } = await import("zod");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // The tables come from the app's own schema (drizzle-kit), so this test runs against what is deployed.
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const schema = await import("@/db/component-jobs");
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson({ ...schema }),
  );
  for (const s of statements) await client.exec(s);
}, 60_000);

describe("jobs.queue.turbineh on PostgreSQL: overlapping runners", () => {
  it("two runners at the same time never run the same job twice", async () => {
    const runs = new Map<string, number>();
    defineJob("c.count", z.object({ n: z.number() }), async (_p, ctx) => {
      runs.set(ctx.jobId, (runs.get(ctx.jobId) ?? 0) + 1);
      await sleep(2);
    });
    const ids = await Promise.all(
      Array.from({ length: 30 }, (_, n) => enqueue("c.count", { n }, { organizationId: "org-1" })),
    );
    const [a, b] = await Promise.all([runDueJobs(50), runDueJobs(50)]);
    expect((a?.done ?? 0) + (b?.done ?? 0)).toBe(30);
    expect(new Set(ids).size).toBe(30);
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    expect(runs.size).toBe(30);
  });

  it("overlapping enqueues with the same idempotency key are one job", async () => {
    defineJob("c.digest", z.object({}), async () => {});
    const later = new Date(Date.now() + 3_600_000); // not due during these tests
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        enqueue(
          "c.digest",
          {},
          { organizationId: "org-1", idempotencyKey: "digest:2026-10-16", runAt: later },
        ),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from jobs where type = 'c.digest'",
    );
    expect(rows[0]?.n).toBe(1);
    // Another workspace with the same key is its own job.
    const other = await enqueue(
      "c.digest",
      {},
      { organizationId: "org-2", idempotencyKey: "digest:2026-10-16", runAt: later },
    );
    expect(other).not.toBe(ids[0]);
  });

  it("a runner whose lease expired and the runner that took over send the effect once", async () => {
    let sends = 0;
    defineJob("c.effect", z.object({}), async (_p, ctx) => {
      await ctx.once("send-email", async () => {
        sends++;
      });
      await sleep(150);
    });
    await enqueue("c.effect", {}, { organizationId: "org-1", maxAttempts: 3 });
    // Runner A: a 50 ms lease and no heartbeat in time — its lease expires while the handler still runs.
    const first = runDueJobs(1, { leaseMs: 50, heartbeatMs: 10_000 });
    await sleep(100);
    // Runner B (the next cron call) reclaims the stale job and runs the handler again.
    const second = await runDueJobs(1, { leaseMs: 30_000 });
    const firstResult = await first;
    expect(second.done).toBe(1);
    expect(firstResult.lost).toBe(1);
    expect(sends).toBe(1);
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from job_effects where key = 'send-email'",
    );
    expect(rows[0]?.n).toBe(1);
  });
});

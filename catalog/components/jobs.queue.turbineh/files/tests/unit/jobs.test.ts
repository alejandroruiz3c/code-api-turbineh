import { describe, expect, it, vi } from "vitest";

// The queue logic is tested without a database; the client module is replaced and an in-memory store with the same
// lease and fencing rules as the Postgres store stands in for it.
vi.mock("@/db/client", () => ({ db: {} }));

const { backoffMs, defineJob, isDefined, runDueJobs, staleAction } = await import("@/lib/jobs");
type JobStore = import("@/lib/jobs").JobStore;
const { z } = await import("zod");

type Row = {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  maxAttempts: number;
  runAt: number;
  leaseUntil: number | null;
  token: number;
  lastError: string | null;
};

function memoryStore(rows: Row[], clock: { now: number }): JobStore {
  const held = (id: string, token: number) =>
    rows.find((r) => r.id === id && r.token === token && r.status === "running");
  return {
    async claim(limit, leaseMs) {
      for (const r of rows) {
        const s = staleAction(
          { ...r, leaseUntil: r.leaseUntil === null ? null : new Date(r.leaseUntil) },
          new Date(clock.now),
        );
        if (s === "fail")
          Object.assign(r, { status: "failed", lastError: "LeaseExpired", leaseUntil: null });
      }
      const due = rows
        .filter(
          (r) =>
            (r.status === "queued" && r.runAt <= clock.now) ||
            (r.status === "running" &&
              (r.leaseUntil ?? 0) < clock.now &&
              r.attempts < r.maxAttempts),
        )
        .slice(0, limit);
      return due.map((r) => {
        Object.assign(r, {
          status: "running",
          attempts: r.attempts + 1,
          token: r.token + 1,
          leaseUntil: clock.now + leaseMs,
        });
        return {
          id: r.id,
          type: r.type,
          payload: {},
          organizationId: "org-1",
          attempts: r.attempts,
          maxAttempts: r.maxAttempts,
          token: r.token,
        };
      });
    },
    async heartbeat(id, token, leaseMs) {
      const r = held(id, token);
      if (r) r.leaseUntil = clock.now + leaseMs;
      return Boolean(r);
    },
    async complete(id, token) {
      const r = held(id, token);
      if (r) Object.assign(r, { status: "done", leaseUntil: null });
      return Boolean(r);
    },
    async fail(id, token, next) {
      const r = held(id, token);
      if (r)
        Object.assign(r, {
          status: next.status,
          runAt: next.runAt.getTime(),
          lastError: next.error,
          leaseUntil: null,
        });
      return Boolean(r);
    },
  };
}

const row = (over: Partial<Row>): Row => ({
  id: "job-1",
  type: "test.ok",
  status: "queued",
  attempts: 0,
  maxAttempts: 3,
  runAt: 0,
  leaseUntil: null,
  token: 0,
  lastError: null,
  ...over,
});

describe("jobs.queue.turbineh", () => {
  it("backs off exponentially and caps at one hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });

  it("registers typed jobs and rejects unsafe type names", () => {
    defineJob("email.reminder", z.object({ to: z.email() }), async () => {});
    expect(isDefined("email.reminder")).toBe(true);
    expect(() => defineJob("DROP TABLE", z.object({}), async () => {})).toThrow(/invalid job type/);
  });

  it("recovers a running job whose lease expired: claimed again with a new fencing token", async () => {
    defineJob("test.ok", z.object({}), async () => {});
    const clock = { now: 1_000_000 };
    // A runner crashed: the job stayed `running` and its lease expired a second ago.
    const rows = [row({ status: "running", attempts: 1, token: 4, leaseUntil: clock.now - 1_000 })];
    const res = await runDueJobs(10, { store: memoryStore(rows, clock), leaseMs: 60_000 });
    expect(res).toEqual({ done: 1, retried: 0, failed: 0, lost: 0 });
    expect(rows[0]).toMatchObject({ status: "done", token: 5, attempts: 2 });
  });

  it("marks a stale running job without attempts left as failed (LeaseExpired), never runs it again", async () => {
    const clock = { now: 1_000_000 };
    const rows = [
      row({ status: "running", attempts: 3, maxAttempts: 3, leaseUntil: clock.now - 1 }),
    ];
    const res = await runDueJobs(10, { store: memoryStore(rows, clock) });
    expect(res).toEqual({ done: 0, retried: 0, failed: 0, lost: 0 });
    expect(rows[0]).toMatchObject({ status: "failed", lastError: "LeaseExpired" });
  });

  it("leaves a running job with a live lease alone", async () => {
    const clock = { now: 1_000_000 };
    const rows = [
      row({ status: "running", attempts: 1, token: 2, leaseUntil: clock.now + 30_000 }),
    ];
    const res = await runDueJobs(10, { store: memoryStore(rows, clock) });
    expect(res).toEqual({ done: 0, retried: 0, failed: 0, lost: 0 });
    expect(rows[0]).toMatchObject({ status: "running", token: 2 });
  });

  it("renews the lease with a heartbeat while the handler runs", async () => {
    const clock = { now: 1_000_000 };
    const rows = [row({ type: "test.slow" })];
    const store = memoryStore(rows, clock);
    defineJob("test.slow", z.object({}), async () => {
      // Time passes beyond the first lease; the heartbeat keeps it alive.
      for (let i = 0; i < 4; i++) {
        clock.now += 30;
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(rows[0]?.leaseUntil).toBeGreaterThan(1_000_000 + 50);
    });
    const res = await runDueJobs(10, { store, leaseMs: 50, heartbeatMs: 5 });
    expect(res.done).toBe(1);
  });

  it("fences a runner whose lease was taken over: its result is not written and the handler is aborted", async () => {
    const clock = { now: 1_000_000 };
    const rows = [row({ type: "test.taken" })];
    const store = memoryStore(rows, clock);
    let aborted = false;
    defineJob("test.taken", z.object({}), async (_p, ctx) => {
      // Another runner reclaims the job (newer token) while this one is still working.
      rows[0]!.token += 1;
      await new Promise((r) => setTimeout(r, 30));
      aborted = ctx.signal.aborted;
    });
    const res = await runDueJobs(10, { store, leaseMs: 60_000, heartbeatMs: 5 });
    expect(res).toEqual({ done: 0, retried: 0, failed: 0, lost: 1 });
    expect(aborted).toBe(true);
    expect(rows[0]?.status).toBe("running");
  });

  it("retries a failing job with backoff and fails it after maxAttempts, fenced by its token", async () => {
    defineJob("test.fails", z.object({}), async () => {
      throw new TypeError("boom");
    });
    const clock = { now: 1_000_000 };
    const rows = [row({ type: "test.fails", maxAttempts: 2 })];
    const store = memoryStore(rows, clock);
    expect(await runDueJobs(10, { store })).toMatchObject({ retried: 1 });
    expect(rows[0]).toMatchObject({ status: "queued", lastError: "TypeError" });
    clock.now = rows[0]!.runAt;
    expect(await runDueJobs(10, { store })).toMatchObject({ failed: 1 });
    expect(rows[0]?.status).toBe("failed");
  });
});

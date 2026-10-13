import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * Scheduled jobs end to end (component jobs.scheduled.turbineh): the cron route is protected by a secret header and
 * every scheduled occurrence of a job runs at most once. The secret is generated per run by playwright.config.ts.
 */
const params = JSON.parse(readFileSync("src/jobs/params.json", "utf8")) as {
  jobs: { id: string; kind: string }[];
};
const secret = process.env.CRON_SECRET ?? "";
type Report = {
  ran: { job: string; scheduledFor: string; sent: number }[];
  skipped: { job: string; scheduledFor: string | null; reason: string }[];
  failed: unknown[];
};

test.describe.serial("scheduled jobs", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the cron route refuses calls without the secret header", async ({ request }) => {
    expect((await request.post("/api/cron/run")).status()).toBe(401);
    expect(
      (
        await request.post("/api/cron/run", {
          headers: { "x-cron-secret": "x".repeat(secret.length) },
        })
      ).status(),
    ).toBe(401);
    expect(
      (await request.get("/api/cron/run", { headers: { authorization: "Bearer wrong" } })).status(),
    ).toBe(401);
  });

  test("a due job runs once per scheduled time: calling again sends nothing (idempotent)", async ({
    request,
  }) => {
    const job = params.jobs.at(-1)!.id;
    const call = async () => {
      const res = await request.post(`/api/cron/run?job=${job}`, {
        headers: { "x-cron-secret": secret },
      });
      expect(res.status()).toBe(200);
      return (await res.json()) as Report;
    };
    const first = await call();
    expect(first.failed).toEqual([]);
    const at = first.ran[0]?.scheduledFor ?? first.skipped[0]?.scheduledFor;
    expect(at).toBeTruthy();
    // Vercel Cron's header works too, and the same occurrence is never run twice.
    const second = (await (
      await request.get(`/api/cron/run?job=${job}`, {
        headers: { authorization: `Bearer ${secret}` },
      })
    ).json()) as Report;
    expect(second.ran).toEqual([]);
    expect(second.skipped).toEqual([{ job, scheduledFor: at, reason: "already ran" }]);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const rows = await client.query(
      "select status from scheduled_runs where job_id = $1 and scheduled_for = $2",
      [job, at],
    );
    await client.end();
    expect(rows.rows).toEqual([{ status: "done" }]);
  });
});

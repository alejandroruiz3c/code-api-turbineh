import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { OWNER_EMAIL } from "./helpers";

/**
 * Email digests of scheduled jobs over workflow records (jobs.scheduled.turbineh with domain.workflow.turbineh):
 * overdue records go to the person who created them, and the daily digest to the members who manage the workspace.
 * Emails are logged when there is no email provider; the run records it.
 */
const jobs = (
  JSON.parse(readFileSync("src/jobs/params.json", "utf8")) as {
    jobs: { id: string; kind: string }[];
  }
).jobs;
const workflows = (
  JSON.parse(readFileSync("src/workflow/params.json", "utf8")) as {
    workflows: { key: string; label: string; dueDate: boolean; createRoles: string[] }[];
  }
).workflows;
const withDue = workflows.find((w) => w.dueDate);
const overdueJob = jobs.find((j) => j.kind === "overdue-digest");
const dailyJob = jobs.find((j) => j.kind === "daily-digest");
const secret = process.env.CRON_SECRET ?? "";
const stamp = Date.now();

function outbox(): { to: string; subject: string }[] {
  try {
    return readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string; subject: string });
  } catch {
    return [];
  }
}

/** Runs one job for its current occurrence (forgetting an earlier run of that occurrence in this test database). */
async function runFresh(request: APIRequestContext, job: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("delete from scheduled_runs where job_id = $1", [job]);
  await client.end();
  const res = await request.post(`/api/cron/run?job=${job}`, {
    headers: { "x-cron-secret": secret },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    ran: { job: string; sent: number; transport: string | null }[];
  };
}

test.describe.serial("scheduled email digests", () => {
  test.skip(!withDue, "no workflow with due dates in this app");

  test("overdue records are emailed every morning to the person who created them, logged when there is no email provider", async ({
    page,
  }) => {
    test.skip(!overdueJob, "no overdue digest in this app's jobs");
    await page.goto(`/dashboard/workflow/${withDue!.key}`);
    await page.getByLabel("Title").fill(`Overdue ${stamp}`);
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Due date").fill(yesterday);
    await page.getByRole("button", { name: `Create ${withDue!.label.toLowerCase()}` }).click();
    await expect(page.getByTestId("overdue")).toBeVisible();
    const before = outbox().length;
    const report = await runFresh(page.request, overdueJob!.id);
    expect(report.ran[0]?.sent).toBeGreaterThan(0);
    expect(report.ran[0]?.transport).toBe("log");
    const mail = outbox()
      .slice(before)
      .find((m) => m.to === OWNER_EMAIL && m.subject.startsWith("Overdue:"));
    expect(mail).toBeTruthy();
  });

  test("the daily digest lists what needs attention to the members who manage the workspace", async ({
    page,
  }) => {
    test.skip(!dailyJob, "no daily digest in this app's jobs");
    const before = outbox().length;
    const report = await runFresh(page.request, dailyJob!.id);
    expect(report.ran[0]?.sent).toBeGreaterThan(0);
    const mail = outbox()
      .slice(before)
      .find((m) => m.to === OWNER_EMAIL && m.subject.startsWith("Daily digest:"));
    expect(mail).toBeTruthy();
  });
});

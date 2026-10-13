import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { SIGN_UP_POLICY } from "../../src/lib/sign-up-policy";
import { OWNER_EMAIL, PASSWORD } from "./helpers";

/** Sign-up with a retry: better-auth allows 3 sign-up requests per 10 s per client in production builds. */
async function signUpRetrying(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Other Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("Other Workspace");
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: "Create account" }).click();
    try {
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 8_000 });
      return;
    } catch {
      await page.waitForTimeout(10_500);
    }
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Audit log (component domain.audit-log.turbineh): each title states the criterion it proves. */
test.describe.serial("audit log", () => {
  test("the owner sees each change in the audit log with who made it and when, and exports it as CSV", async ({
    page,
  }) => {
    const res = await page.request.get("/dashboard/audit/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(await res.text()).toMatch(/^when,who,action,record,recordId,summary,changes/);
    await page.goto("/dashboard/audit");
    const row = page.getByTestId("audit-row").filter({ hasText: "audit.exported" }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(OWNER_EMAIL);
    await expect(row).toContainText(new Date().toISOString().slice(0, 10));
  });

  test("the owner filters the audit log by action and by date", async ({ page }) => {
    await page.goto("/dashboard/audit");
    await page.getByLabel("Action").selectOption("audit.exported");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/action=audit.exported/);
    const rows = page.getByTestId("audit-row");
    await expect(rows.first()).toBeVisible();
    for (const text of await rows.allInnerTexts()) expect(text).toContain("audit.exported");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("To").fill(yesterday);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("audit-total")).toHaveText("0 entries");
  });

  test("audit entries cannot be changed or deleted, not even directly in the database", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string }>("select id from audit_events limit 1");
      const id = rows[0]?.id;
      expect(id).toBeTruthy();
      await expect(
        client.query("update audit_events set summary = 'tampered' where id = $1", [id]),
      ).rejects.toThrow(/append-only/);
      await expect(client.query("delete from audit_events where id = $1", [id])).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await client.end();
    }
  });

  test("another workspace never sees this workspace's audit entries", async ({ browser }) => {
    test.skip(SIGN_UP_POLICY !== "open", "staff-only sign-up: no second workspace can be created");
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signUpRetrying(page, `audit-other-${Date.now()}@example.com`);
    await page.goto("/dashboard/audit");
    await expect(page.getByTestId("audit-total")).toHaveText("0 entries");
    await expect(page.getByText(OWNER_EMAIL)).toHaveCount(0);
    await context.close();
  });
});

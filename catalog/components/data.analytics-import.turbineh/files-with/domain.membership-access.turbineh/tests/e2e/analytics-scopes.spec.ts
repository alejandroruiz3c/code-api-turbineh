import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD } from "./helpers";

/**
 * Per-scope analytics (data.analytics-import.turbineh with domain.membership-access.turbineh): a member restricted to
 * one scope (a shop manager) sees and imports only their shop's figures; the owner sees every shop.
 */
const membership = JSON.parse(readFileSync("src/membership/params.json", "utf8")) as {
  roles: { key: string; can: string[] }[];
  inviteRoles: string[];
  scope: { label: string } | null;
};
const params = JSON.parse(readFileSync("src/analytics-import/params.json", "utf8")) as {
  columns: string[];
  filters?: string[];
  scopeColumn?: string | null;
};
const key = (c: string) =>
  c
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const MEASURE =
  /^(revenue|sales|amount|total|price|cost|quantity|qty|units|count|value|visits|orders|profit|margin|hours|minutes|score)s?$/i;
const columns = params.columns.map(key);
const date = columns.find((c) => /^(date|day)$/.test(c)) ?? columns[0]!;
const measures = columns.filter((c) => c !== date && MEASURE.test(c));
const scope =
  (params.scopeColumn && key(params.scopeColumn)) ??
  columns.find(
    (c) => c !== date && !measures.includes(c) && (params.filters ?? []).map(key).includes(c),
  );
const restricted = membership.inviteRoles
  .map((k) => membership.roles.find((r) => r.key === k))
  .find((r) => r && !r.can.includes("see_all_scopes"));
const label = membership.scope?.label ?? "";
const stamp = Date.now();
const MINE = `Shop ${stamp} A`;
const OTHER = `Shop ${stamp} B`;
const range = "from=2024-05-06&to=2024-05-12";

const line = (day: string, s: string, v: number) =>
  columns
    .map((c) => (c === date ? day : measures.includes(c) ? String(v) : c === scope ? s : "Latte"))
    .join(",");
const csv = (rows: string[]) => Buffer.from([columns.join(","), ...rows].join("\n"));
const total = async (page: Page) =>
  Number(((await page.getByTestId(`total-${measures[0]}`).textContent()) ?? "0").replace(/,/g, ""));

async function importFile(page: Page, rows: string[]) {
  await page.goto("/dashboard/reports/import");
  await page
    .getByLabel("CSV file")
    .setInputFiles({ name: "shops.csv", mimeType: "text/csv", buffer: csv(rows) });
  await page.getByRole("button", { name: "Import" }).click();
}

test.describe.serial("analytics per scope", () => {
  test.skip(!membership.scope || !restricted || !scope, "no per-scope analytics in this app");
  const manager = `manager-${stamp}@example.com`;
  let link = "";

  test("the owner imports every shop's figures and invites a manager for one shop", async ({
    page,
  }) => {
    await page.goto("/dashboard/members");
    for (const name of [MINE, OTHER]) {
      await page.getByLabel(`New ${label.toLowerCase()}`).fill(name);
      await page.getByRole("button", { name: `Add ${label.toLowerCase()}` }).click();
      await expect(page.getByTestId("scope-row").filter({ hasText: name })).toBeVisible();
    }
    await importFile(page, [line("2024-05-06", MINE, 40), line("2024-05-07", OTHER, 60)]);
    await expect(page.getByRole("status")).toContainText("Imported 2 rows");
    await page.goto(`/dashboard/reports?${range}`);
    expect(await total(page)).toBe(100);
    await page.goto("/dashboard/members");
    await page.getByLabel("Email", { exact: true }).fill(manager);
    await page.getByLabel("Role", { exact: true }).selectOption(restricted!.key);
    await page.getByLabel(label, { exact: true }).selectOption({ label: MINE });
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status")).toContainText(`Invitation sent to ${manager}`);
    for (let i = 0; i < 20 && !link; i++) {
      const found = readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; link?: string })
        .filter((m) => m.to === manager && m.link?.includes("/invite/"))
        .at(-1)?.link;
      if (found) link = new URL(found).pathname;
      else await page.waitForTimeout(250);
    }
    expect(link).toMatch(/^\/invite\//);
  });

  test("a shop manager sees only their own shop's figures and cannot import another shop's", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(link);
    await page.getByRole("link", { name: "Create account" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Shop Manager");
    await page.getByLabel("Email").fill(manager);
    await page.getByLabel("Password").fill(PASSWORD);
    // better-auth allows 3 sign-up requests per 10 s per client in production builds: retry after the window.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("button", { name: "Create account" }).click();
      try {
        await expect(page).toHaveURL(new RegExp(link), { timeout: 8_000 });
        break;
      } catch {
        await page.waitForTimeout(10_500);
      }
    }
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto(`/dashboard/reports?${range}`);
    expect(await total(page)).toBe(40);
    await expect(page.getByTestId("compare")).not.toContainText(OTHER);
    if (restricted!.can.includes("create")) {
      await importFile(page, [line("2024-05-08", OTHER, 5)]);
      await expect(page.getByRole("status")).toContainText("Nothing was imported");
      await expect(page.getByTestId("import-report")).toContainText(OTHER);
    }
    await context.close();
  });
});

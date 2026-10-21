import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Recommendation assistant end to end (component ai.recommendations.turbineh + runAgent). The model is the scripted
 * mock in tests/mock-llm (no internet); every step goes through the real tools and the database. Works for any
 * catalogue: the item words, currency and attributes come from this app's src/recommendations/params.json.
 */
type Field = { key: string; label: string; type: string; options?: string[]; match: string };
const params = JSON.parse(
  readFileSync(join(process.cwd(), "src/recommendations/params.json"), "utf8"),
) as { item: { singular: string; plural: string }; currency: string; fields: Field[] };
const ADMIN = (process.env.ADMIN_EMAILS ?? "admin-e2e@example.com").split(",")[0]!.trim();

/** The first numeric "at least" attribute (bedrooms…), used as the stated need; null when the catalogue has none. */
const need =
  params.fields.find((f) => (f.type === "integer" || f.type === "number") && f.match === "min") ??
  null;
const run = String(Date.now()).slice(-6);
const letters = run.replace(/\d/g, (d) => "abcdefghij"[Number(d)] ?? "x");
const town = `Lumen ${letters.charAt(0).toUpperCase()}${letters.slice(1)}`;
const ref = (n: number) => `RA-${run}${n}`;
const money = (n: number) => `${new Intl.NumberFormat("en-GB").format(n)} ${params.currency}`;

/** Values of every configured attribute, with the need's attribute set to `n`. */
const attributes = (n: number) =>
  Object.fromEntries(
    params.fields.map((f) => [
      f.key,
      f === need
        ? n
        : f.type === "enum"
          ? (f.options?.[0] ?? null)
          : f.type === "text"
            ? "standard"
            : 2,
    ]),
  );

// RA-1 and RA-2 fit (budget 320,000, the town, need ≥ 2); every other row breaks exactly one rule.
const ROWS = [
  { n: 1, price: 280_000, location: town, need: 3, verified: true },
  { n: 2, price: 310_000, location: `${town} Old Quarter`, need: 2, verified: true },
  { n: 3, price: 450_000, location: town, need: 4, verified: true }, // over budget
  { n: 4, price: 250_000, location: town, need: 3, verified: false }, // not verified
  { n: 5, price: 200_000, location: "Faraway Hills", need: 3, verified: true }, // other location
  { n: 6, price: 300_000, location: town, need: 1, verified: true }, // below the need
];

async function say(page: Page, message: string): Promise<string> {
  await expect(page.locator('section[data-ready="true"]')).toBeVisible();
  const log = page.getByTestId("assistant-log");
  const before = await log.locator("li[data-role]").count();
  await page.getByLabel("Your message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(log.locator("li[data-role]")).toHaveCount(before + 2, { timeout: 30_000 });
  return (await log.locator("li[data-role]").last().textContent()) ?? "";
}

const statePreferences = (page: Page) =>
  say(
    page,
    `My budget is 320000, I am looking in ${town}${need ? ` with 2 ${need.label.toLowerCase().replace(/\s*\(.*\)$/, "")}` : ""}.`,
  );

async function signInStaff(page: Page): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Staff");
  await page.getByLabel("Email").fill(ADMIN);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByLabel("Workspace name").fill("Staff");
  await page.getByRole("button", { name: "Create account" }).click();
  try {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  } catch {
    // Already registered: sign in instead.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ADMIN);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }
}

test.describe.serial("recommendation assistant (public, no sign-in)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      for (const r of ROWS)
        await pool.query(
          `insert into recommendation_items (reference, title, description, price, currency, location, attributes, verified)
           values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (reference) do nothing`,
          [
            ref(r.n),
            `Test ${params.item.singular} ${r.n}`,
            `Facts of record ${r.n}, checked by staff.`,
            r.price,
            params.currency,
            r.location,
            JSON.stringify(attributes(r.need)),
            r.verified,
          ],
        );
    } finally {
      await pool.end();
    }
  });

  test("a buyer states their budget, preferred location and needs in the conversation: the assistant identifies and records them, and staff see them", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    const reply = await statePreferences(page);
    expect(reply).toContain("Noted");
    expect(reply).toContain(`budget up to ${money(320_000)}`);
    expect(reply).toContain(`location ${town}`);
    if (need) expect(reply.toLowerCase()).toContain(`${need.label.toLowerCase()} at least 2`);
    // Recorded in the database (one profile per conversation) and shown to staff.
    const staff = await browser.newContext();
    const sp = await staff.newPage();
    await signInStaff(sp);
    await sp.goto("/dashboard/catalog/leads");
    const row = sp.locator("tr[data-profile]", { hasText: town });
    await expect(row).toContainText(money(320_000));
    if (need) await expect(row).toContainText(`${need.label}: 2`);
    await staff.close();
  });

  test("recommends only verified records from the catalogue that match the budget, the location and the needs: over-budget, unverified, other-location and too-small ones never appear", async ({
    page,
  }) => {
    await page.goto("/");
    await statePreferences(page);
    const reply = await say(page, "Which ones match?");
    expect(reply).toContain(ref(1));
    expect(reply).toContain(ref(2));
    expect(reply.indexOf(ref(1)), "cheapest first").toBeLessThan(reply.indexOf(ref(2)));
    for (const n of [3, 4, 5, ...(need ? [6] : [])]) expect(reply).not.toContain(ref(n));
    expect(reply).toContain(money(280_000));
  });

  test("answers a question about a record with its verified facts", async ({ page }) => {
    await page.goto("/");
    const reply = await say(page, `How many rooms does ${ref(1)} have?`);
    expect(reply).toContain(`Price: ${money(280_000)}`);
    expect(reply).toContain(`Location: ${town}`);
    if (need) expect(reply).toContain(`${need.label}: 3`);
    expect(reply).toContain("checked by staff");
  });

  test("compares two records side by side in the chat and on the comparison page, with the same facts", async ({
    page,
  }) => {
    await page.goto("/");
    const reply = await say(page, `Please compare ${ref(1)} and ${ref(2)}`);
    expect(reply).toContain(`Price: ${money(280_000)} | ${money(310_000)}`);
    const link = /Side by side: (\/compare\?refs=\S+)/.exec(reply)?.[1];
    expect(link, reply).toBeTruthy();
    await page.goto(link!);
    const table = page.getByRole("table", { name: "Comparison" });
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await expect(table.getByRole("row", { name: /Price/ })).toContainText(money(310_000));
  });

  test("never invents a record: an unknown or unverified reference is refused", async ({
    page,
  }) => {
    await page.goto("/");
    expect(await say(page, "Tell me about ZZ-404404")).toContain("Sorry: No published");
    expect(await say(page, `Tell me about ${ref(4)}`)).toContain("Sorry: No published");
    await page.goto(`/compare?refs=${ref(1)},${ref(4)}`);
    await expect(page.getByText(`Not found: ${ref(4)}`)).toBeVisible();
  });
});

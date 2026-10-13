import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Waitlist mechanics end to end (component growth.waitlist.turbineh): double opt-in through the emailed link,
 * positions, referral links with a boost per confirmed referral, and the owner's CSV export and removal. Settings come
 * from this app's src/waitlist/params.json; emails are read from the logged outbox (no email provider in tests).
 */
const params = JSON.parse(readFileSync("src/waitlist/params.json", "utf8")) as {
  doubleOptIn: boolean;
  showPosition: boolean;
  referral: { enabled: boolean; boost: number };
  ownerCanExport: boolean;
  ownerCanRemove: boolean;
};
const stamp = Date.now();

/** Lines of the logged outbox (playwright.config.ts records it), [] before the first email. */
function outboxLines(): string[] {
  try {
    return readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function linkFor(page: Page, email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const link = outboxLines()
      .map((l) => JSON.parse(l) as { to: string; link?: string })
      .filter((m) => m.to === email && m.link?.includes("/waitlist/confirm/"))
      .at(-1)?.link;
    if (link) return new URL(link).pathname;
    await page.waitForTimeout(250);
  }
  throw new Error(`no waitlist email logged for ${email}`);
}

async function joinAndConfirm(browser: Browser, name: string, email: string, from = "/") {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(from);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("status")).toContainText("You're on the list");
  const link = await linkFor(page, email);
  await page.goto(link);
  if (params.doubleOptIn) {
    await expect(page.getByTestId("position")).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm my email" }).click();
  }
  await expect(page.getByText("You're confirmed")).toBeVisible();
  return { page, link, close: () => context.close() };
}

async function positionOf(page: Page, link: string): Promise<number> {
  await page.goto(link);
  return Number(((await page.getByTestId("position").textContent()) ?? "").replace("#", ""));
}

test.describe.serial("waitlist mechanics", () => {
  const referrer = `referrer-${stamp}@example.com`;
  let referrerLink = "";

  test("a visitor submits a valid email in the landing page hero; it is stored and triggers a double opt-in confirmation email; once confirmed they see their position and referral link", async ({
    browser,
  }) => {
    const r = await joinAndConfirm(browser, "Rita Referrer", referrer);
    referrerLink = r.link;
    if (params.showPosition) await expect(r.page.getByTestId("position")).toHaveText(/^#\d+$/);
    if (params.referral.enabled)
      await expect(r.page.getByLabel(/Your referral link/)).toHaveValue(/\/\?ref=[\w-]+$/);
    await r.close();
  });

  test("a new user signs up through a referral link and confirms their email: the referrer's waitlist position increases by the configured number of places", async ({
    browser,
  }) => {
    test.skip(!params.referral.enabled || !params.showPosition, "no referral boost in this app");
    // Six people confirmed before the referrer (set up directly so the visitor rate limit is not the subject here).
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    for (let i = 0; i < 6; i++)
      await client.query(
        `insert into waitlist_signups (name, email, status, token_hash, referral_code, created_at, confirmed_at)
         values ($1, $2, 'confirmed', $3, $4, now() - interval '1 day', now() - interval '1 day' + make_interval(mins => $5::int))`,
        [
          `Early ${i}`,
          `early-${stamp}-${i}@example.com`,
          `seed-${stamp}-${i}`,
          `e${stamp % 100000}${i}`,
          i,
        ],
      );
    await client.end();
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    const before = await positionOf(page, referrerLink);
    expect(before).toBeGreaterThan(6);
    const ref = ((await page.getByLabel(/Your referral link/).inputValue()) ?? "").split("?")[1];
    const friend = await joinAndConfirm(
      browser,
      "Fran Friend",
      `friend-${stamp}@example.com`,
      `/?${ref}`,
    );
    await friend.close();
    expect(await positionOf(page, referrerLink)).toBe(Math.max(1, before - params.referral.boost));
    await expect(page.getByTestId("referrals")).toHaveText("Confirmed referrals: 1");
    await ctx.close();
  });

  test("an authenticated owner can access the admin dashboard, sees the full list of waitlist entries, uses the export option to generate a CSV and deletes a selected entry", async ({
    page,
  }) => {
    await page.goto("/dashboard/waitlist");
    await expect(page.getByTestId("signup-row").filter({ hasText: referrer })).toBeVisible();
    if (params.ownerCanExport) {
      const csv = await (await page.request.get("/dashboard/waitlist/export")).text();
      expect(csv.split("\n")[0]).toContain("position");
      expect(csv).toContain(referrer);
    }
    if (params.ownerCanRemove) {
      const friend = `friend-${stamp}@example.com`;
      const row = page.getByTestId("signup-row").filter({ hasText: friend });
      test.skip((await row.count()) === 0, "no referral in this app");
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByTestId("signup-row").filter({ hasText: friend })).toHaveCount(0);
    }
  });
});

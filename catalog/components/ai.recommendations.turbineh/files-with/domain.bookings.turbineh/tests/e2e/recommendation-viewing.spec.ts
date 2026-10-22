import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Viewings through the recommendation assistant (ai.recommendations.turbineh with domain.bookings.turbineh): the
 * person picks a real free time, the assistant describes the viewing and books it only after an explicit yes; the
 * booking is a normal appointment (confirmation email, staff calendar) linked to the record it is for.
 */
const bookings = JSON.parse(
  readFileSync(join(process.cwd(), "src/bookings/params.json"), "utf8"),
) as {
  timeZone: string;
  hours: { weekday: number }[];
  policy: { horizonDays: number };
};
const rec = JSON.parse(
  readFileSync(join(process.cwd(), "src/recommendations/params.json"), "utf8"),
) as {
  currency: string;
};
const ADMIN = (process.env.ADMIN_EMAILS ?? "admin-e2e@example.com").split(",")[0]!.trim();
const run = String(Date.now()).slice(-6);
const VERIFIED = `RV-${run}1`;
const UNVERIFIED = `RV-${run}2`;

function openDay(minDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: bookings.timeZone }).format(
    new Date(),
  );
  const start =
    minDays +
    ((Date.now() / 1000) % Math.max(1, Math.min(20, bookings.policy.horizonDays - minDays - 1)));
  for (let i = Math.floor(start); i <= bookings.policy.horizonDays; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (bookings.hours.some((h) => h.weekday === wd)) return d.toISOString().slice(0, 10);
  }
  throw new Error("no open day inside the booking horizon");
}

async function say(page: Page, message: string): Promise<string> {
  await expect(page.locator('section[data-ready="true"]')).toBeVisible();
  const log = page.getByTestId("assistant-log");
  const before = await log.locator("li[data-role]").count();
  await page.getByLabel("Your message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(log.locator("li[data-role]")).toHaveCount(before + 2, { timeout: 30_000 });
  return (await log.locator("li[data-role]").last().textContent()) ?? "";
}

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
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ADMIN);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }
}

test.describe("viewings through the recommendation assistant", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      for (const [reference, verified] of [
        [VERIFIED, true],
        [UNVERIFIED, false],
      ] as const)
        await pool.query(
          `insert into recommendation_items (reference, title, description, price, currency, location, attributes, verified)
           values ($1, 'Viewing test record', '', 250000, $2, 'Test Bay', '{}', $3) on conflict (reference) do nothing`,
          [reference, rec.currency, verified],
        );
    } finally {
      await pool.end();
    }
  });

  test("books a viewing of a recommended record only on a real free time and after the person confirms; it is a booking with its confirmation email and staff see which record it is for", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    const day = openDay(3);
    const free = await say(page, `Which times are free on ${day}?`);
    const slot = new RegExp(`${day} (\\d{2}:\\d{2}) with (.+)`).exec(free);
    expect(slot, free).not.toBeNull();
    const email = `viewer-${run}@example.com`;
    const proposal = await say(
      page,
      `Please arrange a viewing of ${VERIFIED} on ${day} at ${slot![1]} for Ana Ruiz, ${email}`,
    );
    expect(proposal).toContain(`Book a viewing of ${VERIFIED}`);
    expect(proposal).toContain("Shall I go ahead?");
    const done = await say(page, "Yes");
    expect(done).toContain(`Viewing booked: ${VERIFIED}`);
    const booking = /Booking reference ([A-Z0-9]{8})/.exec(done)?.[1];
    expect(booking, done).toBeTruthy();
    expect(done).toContain("confirmation email");

    const staff = await browser.newContext();
    const sp = await staff.newPage();
    await signInStaff(sp);
    await sp.goto("/dashboard/catalog/leads");
    await expect(sp.locator(`tr[data-viewing="${booking}"]`)).toContainText(VERIFIED);
    await sp.goto("/dashboard/appointments");
    await expect(sp.locator(`tr[data-reference="${booking}"]`)).toContainText(email);
    await staff.close();
  });

  test("a viewing of an unpublished record is refused before anything is booked", async ({
    page,
  }) => {
    await page.goto("/");
    const day = openDay(4);
    const reply = await say(
      page,
      `Please arrange a viewing of ${UNVERIFIED} on ${day} at 10:00 for Ana Ruiz, viewer-${run}@example.com`,
    );
    expect(reply).toContain("Sorry: No published");
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  });
});

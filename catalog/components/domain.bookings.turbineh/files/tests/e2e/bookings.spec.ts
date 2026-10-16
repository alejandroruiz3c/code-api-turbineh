import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signUpOrSignIn } from "./helpers";

/**
 * Online booking end to end without AI (component domain.bookings.turbineh): the public booking page, the cancel link
 * and its notice policy, double bookings, the staff calendar, time off, and staff moves/cancellations with customer
 * emails. Works for any business: days, times and names come from this app's src/bookings/params.json.
 */
type Params = {
  business: string;
  timeZone: string;
  hours: { weekday: number; open: string; close: string }[];
  services: { name: string; minutes: number }[];
  policy: { cancelNoticeHours: number; horizonDays: number };
};
const params = JSON.parse(readFileSync("src/bookings/params.json", "utf8")) as Params;
const service = params.services[0]!;
const stamp = Date.now();

/** The n-th open day at least `minDays` ahead (business time zone), varied per run so reruns do not collide. */
function openDay(minDays: number, n = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: params.timeZone }).format(new Date());
  const span = Math.max(1, Math.min(params.policy.horizonDays - minDays - 14, 30));
  const start = minDays + (Math.floor(stamp / 1000) % span);
  let found = 0;
  for (let i = start; i < params.policy.horizonDays; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (params.hours.some((h) => h.weekday === wd)) {
      if (found === n) return d.toISOString().slice(0, 10);
      found++;
    }
  }
  throw new Error("no open day inside the booking horizon");
}
const weekdayOf = (day: string) => {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
};

function outbox(): { to: string; subject: string; link?: string }[] {
  try {
    return readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string; subject: string; link?: string });
  } catch {
    return [];
  }
}

async function mailTo(page: Page, to: string, subject: RegExp) {
  for (let i = 0; i < 40; i++) {
    const m = outbox().find((x) => x.to === to && subject.test(x.subject));
    if (m) return m;
    await page.waitForTimeout(250);
  }
  throw new Error(`no email "${subject}" logged for ${to}`);
}

/** Opens the public page on a day (and team member), fills the details and books the first offered time. */
async function bookFirst(page: Page, day: string, email: string, resource = "") {
  await page.goto(`/book?${new URLSearchParams({ service: service.name, resource, day })}`);
  await expect(page.getByTestId("slots")).toBeVisible();
  await page.getByLabel("Name").fill("Lucía Pérez");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone").fill("+34 600 000 000");
  await page.getByRole("button", { name: "Book", exact: true }).click();
}

async function anonymous(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

test.describe.serial("online booking (public page, cancel link, staff calendar)", () => {
  const email = `customer-${stamp}@example.com`;
  let reference = "";
  let resourceName = "";
  let cancelLink = "";

  test("a customer books a free time on the public page without an account: provides name, email and phone, the booking is created and a confirmation email with a cancel link is sent", async ({
    browser,
  }) => {
    const page = await anonymous(browser);
    await bookFirst(page, openDay(3, 0), email);
    const booked = page.getByTestId("booked");
    await expect(booked).toContainText("Booked!");
    await expect(
      booked,
      "booked with any team member: the booking names the free team member it was assigned to",
    ).toContainText(/ with \S.* on /);
    reference = /Reference (\w+)/.exec((await booked.textContent()) ?? "")?.[1] ?? "";
    expect(reference).toMatch(/^\w{8}$/);
    const mail = await mailTo(page, email, new RegExp(`${reference} is confirmed`));
    expect(mail.link).toMatch(/\/book\/cancel\/[\w-]{20,}$/);
    cancelLink = new URL(mail.link!).pathname;
    await page.context().close();
  });

  test("a customer cannot book a slot already taken: the same time is never booked twice for one team member (double booking prevented)", async ({
    browser,
  }) => {
    const day = openDay(3, 1);
    const a = await anonymous(browser);
    await a.goto(`/book?${new URLSearchParams({ service: service.name, day })}`);
    resourceName = (await a.locator("#book-resource option").nth(1).textContent()) ?? "";
    expect(resourceName).not.toBe("");
    const b = await anonymous(browser);
    await bookFirst(a, day, `first-${stamp}@example.com`, resourceName);
    await expect(a.getByTestId("booked")).toContainText(resourceName);
    // Anyone loading the page afterwards is no longer offered that time with that person.
    await b.goto(
      `/book?${new URLSearchParams({ service: service.name, resource: resourceName, day })}`,
    );
    const firstTime = /with .+ on \w+ \S+ (\d{2}:\d{2})/.exec(
      (await a.getByTestId("booked").textContent()) ?? "",
    )?.[1];
    expect(firstTime).toBeTruthy();
    await expect(b.getByRole("radio", { name: `${firstTime} with ${resourceName}` })).toHaveCount(
      0,
    );
    // A stale page that still offers it is refused by the server.
    const c = await anonymous(browser);
    await c.goto(
      `/book?${new URLSearchParams({ service: service.name, resource: resourceName, day })}`,
    );
    await c.evaluate(
      ([t, r]) => {
        const input = document.querySelector<HTMLInputElement>('input[name="slot"]');
        if (input) input.value = `${t}|${r}`;
      },
      [firstTime!, resourceName],
    );
    await c.getByLabel("Name").fill("Second Person");
    await c.getByLabel("Email").fill(`second-${stamp}@example.com`);
    await c.getByLabel("Phone").fill("+34 600 000 001");
    await c.getByRole("button", { name: "Book", exact: true }).click();
    await expect(
      c.getByRole("alert").filter({ hasText: /not available|just taken/ }),
    ).toBeVisible();
    for (const p of [a, b, c]) await p.context().close();
  });

  test("a customer cancels the booking with the link of the confirmation email more than the notice hours before the start time; inside the notice period the link is refused", async ({
    browser,
  }) => {
    const page = await anonymous(browser);
    await page.goto(cancelLink);
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByRole("status")).toContainText(`Booking ${reference}`);
    await expect(page.getByRole("status")).toContainText("is cancelled");
    await mailTo(page, email, new RegExp(`${reference} cancelled`));
    // A second booking that now starts in one hour (inside the notice period).
    const late = `late-${stamp}@example.com`;
    await bookFirst(page, openDay(3, 2), late);
    const lateRef = /Reference (\w+)/.exec(
      (await page.getByTestId("booked").textContent()) ?? "",
    )?.[1];
    const mail = await mailTo(page, late, new RegExp(`${lateRef} is confirmed`));
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      `update booking_appointments set starts_at = now() + interval '1 hour',
              ends_at = now() + interval '1 hour' + make_interval(mins => $2) where reference = $1`,
      [lateRef, service.minutes],
    );
    await client.end();
    await page.goto(new URL(mail.link!).pathname);
    await expect(page.getByTestId("too-late")).toContainText(
      `up to ${params.policy.cancelNoticeHours} hours before`,
    );
    await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
    await page.context().close();
  });

  test("a staff member signs in and sees the bookings in the day and week calendar per team member (stylist, therapist…)", async ({
    page,
  }) => {
    const day = openDay(3, 1);
    await page.goto(`/dashboard/appointments/calendar?view=day&date=${day}`);
    const row = page.locator(`[data-testid="calendar-row"][data-resource="${resourceName}"]`);
    await expect(
      row.getByTestId("calendar-entry").filter({ hasText: "Lucía Pérez" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page.getByTestId("calendar-range")).toContainText("Week of");
    await expect(
      row.getByTestId("calendar-entry").filter({ hasText: "Lucía Pérez" }),
    ).toBeVisible();
  });

  test("a staff member blocks time off to make those time slots unavailable for booking; customers are no longer offered them", async ({
    page,
    browser,
  }) => {
    const day = openDay(3, 3);
    const hours = params.hours.filter((h) => h.weekday === weekdayOf(day));
    await page.goto("/dashboard/appointments/time-off");
    await page.locator("#to-resource").selectOption({ label: resourceName });
    await page.getByLabel("Day").fill(day);
    await page.getByLabel("From").fill(hours[0]!.open);
    await page.getByLabel("To", { exact: true }).fill(hours.at(-1)!.close);
    await page.getByLabel("Reason").fill("Training");
    await page.getByRole("button", { name: "Block time" }).click();
    await expect(page.getByRole("status")).toHaveText("Time off saved.");
    const visitor = await anonymous(browser);
    await visitor.goto(
      `/book?${new URLSearchParams({ service: service.name, resource: resourceName, day })}`,
    );
    await expect(visitor.getByTestId("no-slots")).toBeVisible();
    await visitor.context().close();
    await page.goto(`/dashboard/appointments/calendar?view=day&date=${day}`);
    await expect(
      page.locator('[data-kind="time-off"]').filter({ hasText: "Training" }),
    ).toBeVisible();
  });

  test("a staff member moves an existing booking to a different time slot, then cancels it, triggering an automated email to the customer each time", async ({
    page,
  }) => {
    const customer = `first-${stamp}@example.com`;
    await page.goto("/dashboard/appointments");
    const row = page.locator("tr").filter({ hasText: customer });
    await row.getByRole("link").click();
    const day = openDay(3, 4);
    const open = params.hours.filter((h) => h.weekday === weekdayOf(day))[0]!.open;
    await page.getByLabel("New date").fill(day);
    await page.getByLabel("New time").fill(open);
    await page.getByRole("button", { name: "Move booking" }).click();
    await expect(page.getByRole("status")).toContainText("The customer was emailed.");
    await mailTo(page, customer, /moved$/);
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByTestId("booking-status")).toHaveText("cancelled");
    await mailTo(page, customer, /cancelled$/);
  });

  test("a booking outside the opening hours is rejected: on a closed day no time is offered, and a time after closing is refused", async ({
    page,
    browser,
  }) => {
    // A closed weekday inside the horizon (skipped when the business opens every day).
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: params.timeZone }).format(
      new Date(),
    );
    let closed: string | null = null;
    for (let i = 2; i < Math.min(params.policy.horizonDays, 14) && !closed; i++) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const day = d.toISOString().slice(0, 10);
      if (!params.hours.some((h) => h.weekday === weekdayOf(day))) closed = day;
    }
    if (closed) {
      const visitor = await anonymous(browser);
      await visitor.goto(`/book?${new URLSearchParams({ service: service.name, day: closed })}`);
      await expect(visitor.getByTestId("no-slots")).toContainText("closed");
      await expect(visitor.getByTestId("slots")).toHaveCount(0);
      await visitor.context().close();
    }
    // A staff booking at closing time (nothing can start then and still end inside the hours) is refused.
    const day = openDay(3, 5);
    const close = params.hours.filter((h) => h.weekday === weekdayOf(day)).at(-1)!.close;
    await page.goto("/dashboard/appointments");
    await page.getByLabel("Date").fill(day);
    await page.getByLabel("Time").fill(close);
    await page.getByLabel("Full name").fill("After Hours");
    await page.getByLabel("Email", { exact: true }).fill(`late-night-${stamp}@example.com`);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /not available|no free times/ }),
    ).toBeVisible();
  });

  test("people who are not staff cannot see the bookings", async ({ browser }) => {
    const page = await anonymous(browser);
    await signUpOrSignIn(page, `visitor-${stamp}@example.com`);
    await page.goto("/dashboard/appointments");
    await expect(page.getByRole("status")).toContainText("Only staff");
    await page.goto("/dashboard/appointments/calendar");
    await expect(page.getByRole("status")).toContainText("Only staff");
    await page.context().close();
  });
});

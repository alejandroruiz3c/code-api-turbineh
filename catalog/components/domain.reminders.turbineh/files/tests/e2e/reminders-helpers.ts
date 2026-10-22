import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Shared steps of the reminder E2E suites (domain.reminders.turbineh): book on the public page, bring the appointment
 * inside its reminder window (the database stands in for the clock), run the cron route's reminder task, read emails
 * and reminder rows. Days, services and the time zone come from this app's params.
 */
type BookingParams = {
  timeZone: string;
  hours: { weekday: number }[];
  services: { name: string; minutes: number }[];
  policy: { horizonDays: number };
};
export const booking = JSON.parse(
  readFileSync("src/bookings/params.json", "utf8"),
) as BookingParams;
export const reminders = JSON.parse(readFileSync("src/reminders/params.json", "utf8")) as {
  hoursBefore: number;
  channels: string[];
  whatsappTemplate: { name: string; language: string };
};
const service = booking.services[0]!;
const stamp = Date.now();

/** An open day at least `minDays` ahead, varied per run and per call. */
export function openDay(minDays: number, n = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: booking.timeZone }).format(new Date());
  const span = Math.max(1, Math.min(booking.policy.horizonDays - minDays - 14, 30));
  const start = minDays + (Math.floor(stamp / 1000) % span);
  let found = 0;
  for (let i = start; i < booking.policy.horizonDays; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (booking.hours.some((h) => h.weekday === wd)) {
      if (found === n) return d.toISOString().slice(0, 10);
      found++;
    }
  }
  throw new Error("no open day inside the booking horizon");
}

export async function anonymous(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

/**
 * Books the first free time of a day on the public page; returns the booking reference. The public form is
 * rate-limited per address (10 a minute): when the run has booked that many already, it waits for the window.
 */
export async function book(
  page: Page,
  input: { day: string; email: string; phone?: string; tick?: ("sms" | "whatsapp")[] },
): Promise<string> {
  let taken = 0;
  for (let attempt = 0; ; attempt++) {
    await page.goto(`/book?${new URLSearchParams({ service: service.name, day: input.day })}`);
    await expect(page.getByTestId("slots")).toBeVisible();
    await page.getByLabel("Name").fill("Lucía Pérez");
    await page.getByLabel("Email").fill(input.email);
    if (input.phone) await page.getByLabel(/^Phone/).fill(input.phone);
    for (const c of input.tick ?? []) await page.locator(`input[name="${c}Reminders"]`).check();
    // Another suite may hold a time it moved away in the database: take the next free time then.
    if (taken > 0) await page.locator('input[name="slot"]').nth(taken).check();
    await page.getByRole("button", { name: "Book", exact: true }).click();
    const booked = page.getByTestId("booked");
    const refused = page.getByRole("form", { name: "Book" }).getByRole("alert");
    await expect(booked.or(refused)).toBeVisible();
    if (await booked.isVisible()) {
      await expect(booked).toContainText("Booked!");
      return /Reference (\w+)/.exec((await booked.textContent()) ?? "")?.[1] ?? "";
    }
    const why = (await refused.textContent()) ?? "";
    if (/just taken/i.test(why) && taken < 5) {
      taken++;
      continue;
    }
    if (!/too many attempts/i.test(why) || attempt >= 8) throw new Error(`booking refused: ${why}`);
    await page.waitForTimeout(12_000);
  }
}

export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/**
 * Moves an appointment so that it starts `hoursBefore - 1` hours from now (its reminder time has just passed), as if it
 * had been booked days ago. Returns its new start.
 */
export async function intoReminderWindow(reference: string): Promise<Date> {
  const start = new Date(Date.now() + (reminders.hoursBefore - 1) * 3_600_000);
  start.setUTCSeconds(0, 0);
  await sql(
    `update booking_appointments set starts_at = $2, ends_at = $2::timestamptz + make_interval(mins => $3),
       created_at = now() - interval '10 days' where reference = $1`,
    [reference, start.toISOString(), service.minutes],
  );
  // The time it left is free again for later bookings (its slot locks went with it).
  await sql(
    "delete from booking_slot_locks where appointment_id = (select id from booking_appointments where reference = $1)",
    [reference],
  );
  return start;
}

/** Runs the reminder task of the cron route (jobs.scheduled.turbineh), as a scheduler does. */
export async function runReminders(request: APIRequestContext) {
  const res = await request.post("/api/cron/run?task=booking-reminders", {
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  expect(res.status()).toBe(200);
  const report = (await res.json()) as {
    tasks: { task: string; sent: number; skipped: number; failed: number; error: string | null }[];
  };
  const task = report.tasks.find((t) => t.task === "booking-reminders");
  expect(task?.error ?? null).toBeNull();
  return task!;
}

export const remindersOf = (reference: string, channel?: string) =>
  sql<{ channel: string; status: string; reason: string | null; attempts: number }>(
    `select r.channel, r.status, r.reason, r.attempts from booking_reminders r
       join booking_appointments a on a.id = r.appointment_id
      where a.reference = $1 ${channel ? "and r.channel = $2" : ""} order by r.created_at`,
    channel ? [reference, channel] : [reference],
  );

export function outbox(): { to: string; subject: string; text?: string; link?: string }[] {
  try {
    return readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string; subject: string; text?: string; link?: string });
  } catch {
    return [];
  }
}

/** "Sunday 2026-10-25 10:00" in the business time zone, written independently of the app. */
export function localWhen(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: booking.timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

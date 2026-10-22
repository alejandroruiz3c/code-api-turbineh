import { expect, test } from "@playwright/test";
import {
  anonymous,
  book,
  booking,
  intoReminderWindow,
  localWhen,
  openDay,
  outbox,
  reminders,
  remindersOf,
  runReminders,
} from "./reminders-helpers";

/**
 * Appointment reminders end to end (component domain.reminders.turbineh): the cron route's reminder task emails each
 * confirmed appointment's customer the set number of hours before it, once, with the local time; cancelled
 * appointments get nothing. Emails are logged to the E2E outbox (no provider), exactly as in production without one.
 */
const stamp = Date.now();
let remindedRef = "";

test.describe.serial("appointment reminders by email", () => {
  // Bookings go through the rate-limited public form: a test may wait for its window.
  test.setTimeout(150_000);
  test.skip(!reminders.channels.includes("email"), "this app does not send email reminders");

  test("a customer gets an email reminder the set number of hours before the appointment, once per appointment, with the local time of the business", async ({
    browser,
    request,
  }) => {
    const email = `reminded-${stamp}@example.com`;
    const page = await anonymous(browser);
    const reference = await book(page, { day: openDay(3, 2), email });
    remindedRef = reference;
    await page.context().close();
    // Before its reminder time nothing is sent.
    await runReminders(request);
    expect(outbox().filter((m) => m.to === email && /reminder/i.test(m.subject))).toEqual([]);
    const start = await intoReminderWindow(reference);
    await runReminders(request);
    const sent = outbox().filter((m) => m.to === email && /reminder/i.test(m.subject));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(`${localWhen(start)} (${booking.timeZone})`);
    expect(sent[0]?.text).toContain(reference);
    // Calling again (a retry, a second scheduler) sends nothing more: one reminder per appointment and channel.
    await runReminders(request);
    await runReminders(request);
    expect(outbox().filter((m) => m.to === email && /reminder/i.test(m.subject))).toHaveLength(1);
    expect(await remindersOf(reference, "email")).toEqual([
      { channel: "email", status: "logged", reason: "no email provider configured", attempts: 1 },
    ]);
  });

  test("a cancelled appointment never gets a reminder", async ({ browser, request }) => {
    const email = `cancelled-${stamp}@example.com`;
    const page = await anonymous(browser);
    const reference = await book(page, { day: openDay(3, 3), email });
    // The customer cancels with the link of the confirmation email.
    let link = "";
    for (let i = 0; i < 40 && !link; i++) {
      link = outbox().find((m) => m.to === email && m.subject.includes(reference))?.link ?? "";
      if (!link) await page.waitForTimeout(250);
    }
    await page.goto(new URL(link).pathname);
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByRole("status")).toContainText("is cancelled");
    await page.context().close();
    await intoReminderWindow(reference);
    await runReminders(request);
    expect(outbox().filter((m) => m.to === email && /reminder/i.test(m.subject))).toEqual([]);
    expect(await remindersOf(reference)).toEqual([]);
  });

  test("staff see each appointment's reminders and their status", async ({ page }) => {
    await page.goto("/dashboard/appointments/reminders");
    await expect(page.getByTestId("reminder-policy")).toContainText(
      `${reminders.hoursBefore} hours before each appointment`,
    );
    await expect(
      page
        .locator(`tr[data-reference="${remindedRef}"][data-channel="email"]`)
        .getByTestId("reminder-status"),
    ).toHaveText("logged");
  });
});

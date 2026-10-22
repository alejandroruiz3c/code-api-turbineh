import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  anonymous,
  book,
  booking,
  intoReminderWindow,
  localWhen,
  openDay,
  reminders,
  remindersOf,
  runReminders,
  sql,
} from "./reminders-helpers";

/**
 * SMS reminders end to end (domain.reminders.turbineh with messaging.sms.twilio) against the offline Twilio mock
 * (tests/e2e/mocks/TWILIO_API_BASE.ts), which checks each request like Twilio's Messages API and posts signed delivery
 * updates back. SMS goes only to people who ticked the box; a STOP reply stops it; failures are retried.
 */
const twilio = process.env.TWILIO_API_BASE ?? "";
const stamp = Date.now();
type Sent = { path: string; form: Record<string, string> };
const sentTo = async (phone: string): Promise<Sent[]> =>
  ((await (await fetch(`${twilio}/__mock/requests`)).json()) as Sent[]).filter(
    (r) => r.form.To === phone,
  );

/** A reply to the app's number as Twilio posts it: form-encoded and signed with the auth token over the full URL. */
async function reply(request: APIRequestContext, from: string, body: string, signed = true) {
  const url = `${process.env.APP_URL}/api/messaging/sms/webhook`;
  const params: Record<string, string> = {
    AccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    MessageSid: `SM${stamp}${body}`,
    From: from,
    To: process.env.TWILIO_FROM_NUMBER ?? "",
    Body: body,
  };
  const signature = createHmac("sha1", process.env.TWILIO_AUTH_TOKEN ?? "")
    .update(
      url +
        Object.keys(params)
          .sort()
          .map((k) => `${k}${params[k]}`)
          .join(""),
    )
    .digest("base64");
  return request.post("/api/messaging/sms/webhook", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signed ? signature : "forged",
    },
    data: new URLSearchParams(params).toString(),
  });
}

test.describe.serial("appointment reminders by SMS (Twilio)", () => {
  // Bookings go through the rate-limited public form: a test may wait for its window.
  test.setTimeout(150_000);
  test.skip(!reminders.channels.includes("sms"), "this app does not send SMS reminders");
  const phone = `+3461${String(stamp).slice(-7)}`;

  test("a customer who agreed to SMS reminders gets an SMS reminder the set number of hours before the appointment, once, through Twilio's Messages API; the signed delivery update is recorded", async ({
    browser,
    request,
  }) => {
    const page = await anonymous(browser);
    // Ticking the box without a reachable number is refused: nothing is booked (waiting out the form's rate limit).
    for (let attempt = 0; ; attempt++) {
      await page.goto(
        `/book?${new URLSearchParams({ service: booking.services[0]!.name, day: openDay(4, 0) })}`,
      );
      await page.getByLabel("Name").fill("Lucía Pérez");
      await page.getByLabel("Email").fill(`nophone-${stamp}@example.com`);
      await page.locator('input[name="smsReminders"]').check();
      await page.getByRole("button", { name: "Book", exact: true }).click();
      const alert = page.getByRole("form", { name: "Book" }).getByRole("alert");
      await expect(alert).toBeVisible();
      if (!/too many attempts/i.test((await alert.textContent()) ?? "") || attempt >= 6) {
        await expect(alert).toContainText("country code");
        break;
      }
      await page.waitForTimeout(12_000);
    }
    const reference = await book(page, {
      day: openDay(4, 0),
      email: `sms-${stamp}@example.com`,
      phone: `${phone.slice(0, 3)} ${phone.slice(3)}`,
      tick: ["sms"],
    });
    await page.context().close();
    const start = await intoReminderWindow(reference);
    await runReminders(request);
    const sent = await sentTo(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(
      `/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    );
    expect(sent[0]?.form.From).toBe(process.env.TWILIO_FROM_NUMBER);
    expect(sent[0]?.form.Body).toContain(`${localWhen(start)} (${booking.timeZone})`);
    expect(sent[0]?.form.Body).toContain("Reply STOP");
    await runReminders(request);
    expect(await sentTo(phone)).toHaveLength(1);
    expect(await remindersOf(reference, "sms")).toMatchObject([{ status: "sent", attempts: 1 }]);
    // Twilio's StatusCallback reaches the signed webhook and updates the message log.
    await expect
      .poll(
        async () =>
          (
            await sql<{ status: string }>(
              'select status from sms_messages where "to" = $1 and provider_sid is not null',
              [phone],
            )
          )[0]?.status,
      )
      .toBe("delivered");
  });

  test("a customer who replies STOP gets no more SMS reminders; an unsigned reply is refused", async ({
    browser,
    request,
  }) => {
    expect((await reply(request, phone, "STOP", false)).status()).toBe(403);
    expect((await reply(request, phone, "STOP")).status()).toBe(200);
    expect(await sql("select status, source from sms_consent where phone = $1", [phone])).toEqual([
      { status: "opted_out", source: "keyword:STOP" },
    ]);
    // Booking again and ticking the box does not override the STOP.
    const page = await anonymous(browser);
    const reference = await book(page, {
      day: openDay(4, 1),
      email: `sms2-${stamp}@example.com`,
      phone,
      tick: ["sms"],
    });
    await page.context().close();
    await intoReminderWindow(reference);
    await runReminders(request);
    expect(await sentTo(phone)).toHaveLength(1);
    expect(await remindersOf(reference, "sms")).toMatchObject([
      { status: "skipped", reason: "opted-out" },
    ]);
  });

  test("a customer who did not tick the SMS box gets no SMS reminder", async ({
    browser,
    request,
  }) => {
    const other = `+3462${String(stamp).slice(-7)}`;
    const page = await anonymous(browser);
    const reference = await book(page, {
      day: openDay(4, 2),
      email: `nosms-${stamp}@example.com`,
      phone: other,
    });
    await page.context().close();
    await intoReminderWindow(reference);
    await runReminders(request);
    expect(await sentTo(other)).toEqual([]);
    expect(await remindersOf(reference, "sms")).toMatchObject([
      { status: "skipped", reason: "no-consent" },
    ]);
  });

  test("a failed SMS reminder is retried with backoff on a later run and then sent; once an appointment is cancelled its pending retry is dropped", async ({
    browser,
    request,
  }) => {
    const retried = `+3463${String(stamp).slice(-7)}`;
    const page = await anonymous(browser);
    const reference = await book(page, {
      day: openDay(4, 3),
      email: `retry-${stamp}@example.com`,
      phone: retried,
      tick: ["sms"],
    });
    await page.context().close();
    await intoReminderWindow(reference);
    // Twilio answers 503 to every attempt of this run.
    await fetch(`${twilio}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({ status: 503, times: 10 }),
    });
    await runReminders(request);
    await fetch(`${twilio}/__mock/fail`, { method: "DELETE" });
    const [first] = await sql<{ status: string; next_attempt_at: Date }>(
      `select r.status, r.next_attempt_at from booking_reminders r join booking_appointments a on a.id = r.appointment_id
        where a.reference = $1 and r.channel = 'sms'`,
      [reference],
    );
    expect(first?.status).toBe("retrying");
    expect(new Date(first!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    // The mock records the refused attempts too (three in that run, the SMS component's attempt limit).
    const attempts = (await sentTo(retried)).length;
    expect(attempts).toBeGreaterThan(0);
    // Not before its time…
    await runReminders(request);
    expect(await sentTo(retried)).toHaveLength(attempts);
    // …and sent once it is due.
    await sql(
      `update booking_reminders set next_attempt_at = now() - interval '1 minute'
        where appointment_id = (select id from booking_appointments where reference = $1)`,
      [reference],
    );
    await runReminders(request);
    expect(await sentTo(retried)).toHaveLength(attempts + 1);
    expect(await remindersOf(reference, "sms")).toMatchObject([{ status: "sent", attempts: 2 }]);

    // Another failed reminder whose appointment is then cancelled: nothing more is sent for it.
    const dropped = `+3464${String(stamp).slice(-7)}`;
    const page2 = await anonymous(browser);
    const second = await book(page2, {
      day: openDay(4, 4),
      email: `dropped-${stamp}@example.com`,
      phone: dropped,
      tick: ["sms"],
    });
    await page2.context().close();
    await intoReminderWindow(second);
    await fetch(`${twilio}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({ status: 503, times: 10 }),
    });
    await runReminders(request);
    await fetch(`${twilio}/__mock/fail`, { method: "DELETE" });
    expect(await remindersOf(second, "sms")).toMatchObject([{ status: "retrying" }]);
    await sql("update booking_appointments set status = 'cancelled' where reference = $1", [
      second,
    ]);
    await sql(
      `update booking_reminders set next_attempt_at = now() - interval '1 minute'
        where appointment_id = (select id from booking_appointments where reference = $1)`,
      [second],
    );
    const tried = (await sentTo(dropped)).length;
    await runReminders(request);
    expect(await sentTo(dropped)).toHaveLength(tried);
    expect(await remindersOf(second, "sms")).toMatchObject([
      { status: "cancelled", reason: "appointment cancelled" },
    ]);
  });
});

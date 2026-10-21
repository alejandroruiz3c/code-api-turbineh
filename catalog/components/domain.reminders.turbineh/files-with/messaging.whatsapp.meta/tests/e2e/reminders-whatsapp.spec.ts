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
 * WhatsApp reminders end to end (domain.reminders.turbineh with messaging.whatsapp.meta) against the offline Cloud API
 * mock (tests/e2e/mocks/WHATSAPP_API_BASE.ts), which accepts only approved templates with the right parameters and
 * posts signed status webhooks. WhatsApp goes only to people who opted in on the booking form; STOP stops it.
 */
const graph = process.env.WHATSAPP_API_BASE ?? "";
const stamp = Date.now();
type Sent = { path: string; json: Record<string, unknown> | null };
const sentTo = async (phone: string): Promise<Sent[]> =>
  ((await (await fetch(`${graph}/__mock/requests`)).json()) as Sent[]).filter(
    (r) => r.json?.to === phone,
  );

/** A message from the customer as Meta posts it to the webhook, signed with the app secret. */
async function inbound(request: APIRequestContext, phone: string, text: string, signed = true) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              messages: [
                {
                  from: phone.replace(/^\+/, ""),
                  id: `wamid.in${stamp}`,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "")
    .update(body)
    .digest("hex")}`;
  return request.post("/api/messaging/whatsapp/webhook", {
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signed ? signature : "sha256=00",
    },
    data: body,
  });
}

test.describe.serial("appointment reminders by WhatsApp (Cloud API)", () => {
  // Bookings go through the rate-limited public form: a test may wait for its window.
  test.setTimeout(150_000);
  test.skip(!reminders.channels.includes("whatsapp"), "this app does not send WhatsApp reminders");
  const phone = `+3465${String(stamp).slice(-7)}`;

  test("the webhook answers Meta's verification request only with the verify token", async ({
    request,
  }) => {
    const ok = await request.get(
      `/api/messaging/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=1158201444`,
    );
    expect(await ok.text()).toBe("1158201444");
    const bad = await request.get(
      "/api/messaging/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
    );
    expect(bad.status()).toBe(403);
  });

  test("a customer who opted in gets a WhatsApp reminder the set number of hours before the appointment, once, as the approved template with its parameters; Meta's signed statuses are recorded", async ({
    browser,
    request,
  }) => {
    const page = await anonymous(browser);
    const reference = await book(page, {
      day: openDay(5, 0),
      email: `wa-${stamp}@example.com`,
      phone,
      tick: ["whatsapp"],
    });
    await page.context().close();
    const start = await intoReminderWindow(reference);
    await runReminders(request);
    await runReminders(request);
    const sent = await sentTo(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(`/v26.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`);
    expect(sent[0]?.json).toMatchObject({
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: reminders.whatsappTemplate.name,
        language: { code: reminders.whatsappTemplate.language },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Lucía Pérez" },
              { type: "text", text: booking.services[0]!.name },
              { type: "text", text: `${localWhen(start)} (${booking.timeZone})` },
              { type: "text" },
            ],
          },
        ],
      },
    });
    expect(await remindersOf(reference, "whatsapp")).toMatchObject([
      { status: "sent", attempts: 1 },
    ]);
    await expect
      .poll(
        async () =>
          (
            await sql<{ status: string }>(
              'select status from whatsapp_messages where "to" = $1 and provider_id is not null',
              [phone],
            )
          )[0]?.status,
      )
      .toBe("delivered");
  });

  test("a customer who writes STOP gets no more WhatsApp reminders; an unsigned webhook call is refused", async ({
    browser,
    request,
  }) => {
    expect((await inbound(request, phone, "STOP", false)).status()).toBe(403);
    expect((await inbound(request, phone, "STOP")).status()).toBe(200);
    const page = await anonymous(browser);
    const reference = await book(page, {
      day: openDay(5, 1),
      email: `wa2-${stamp}@example.com`,
      phone,
      tick: ["whatsapp"],
    });
    await page.context().close();
    await intoReminderWindow(reference);
    await runReminders(request);
    expect(await sentTo(phone)).toHaveLength(1);
    expect(await remindersOf(reference, "whatsapp")).toMatchObject([
      { status: "skipped", reason: "opted-out" },
    ]);
  });
});

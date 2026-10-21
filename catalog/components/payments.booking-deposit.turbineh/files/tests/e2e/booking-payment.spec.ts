import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { amountDue, DepositParams } from "../../src/payments/deposit";
import {
  sessionEvent,
  standInCheckout,
  stripeSessions,
  stripeSignature,
  type StripeSession,
} from "./booking-payment-step";

/**
 * Payment at booking time end to end (component payments.booking-deposit.turbineh, on domain.bookings.turbineh):
 * Stripe Checkout with the server's amount, the time held while the customer pays, the signed webhook as the only
 * way to confirm, an expired payment freeing the time, and a late payment refunded instead of double-booking. Offline:
 * Stripe's API is the local mock (tests/e2e/mocks/STRIPE_API_BASE.mjs) and its hosted page a stand-in.
 */
type Params = {
  timeZone: string;
  hours: { weekday: number; open: string; close: string }[];
  services: { name: string; minutes: number; price: number | null; currency: string | null }[];
  policy: { horizonDays: number };
};
const params = JSON.parse(readFileSync("src/bookings/params.json", "utf8")) as Params;
const depositConfig = DepositParams.parse(
  JSON.parse(readFileSync("src/payments/booking-deposit.json", "utf8")),
);
const service = params.services.find((s) => amountDue(s, depositConfig) !== null)!;
const due = amountDue(service, depositConfig)!;
const stamp = Date.now();

/**
 * The n-th open day counted back from the end of the booking horizon: the bookings suite books near the start of
 * the horizon and blocks whole days there, so the two suites never share a day.
 */
function openDay(n = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: params.timeZone }).format(new Date());
  let found = 0;
  for (let i = params.policy.horizonDays - 1; i > 0; i--) {
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

async function anonymous(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

async function sql<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Fills the public page for the first free time of `day` and clicks Book; returns the time offered. */
async function bookUntilCheckout(page: Page, day: string, email: string): Promise<string> {
  await page.goto(`/book?${new URLSearchParams({ service: service.name, day })}`);
  const slot = page.locator('input[name="slot"]').first();
  const value = (await slot.getAttribute("value")) ?? "";
  await page.getByLabel("Name").fill("Marta Gil");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone").fill("+34 600 000 002");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  return value;
}

async function sessionOf(page: Page): Promise<StripeSession> {
  const id = /cs_test_[A-Za-z0-9]+/.exec(page.url())?.[0] ?? "";
  const s = (await stripeSessions()).find((x) => x.id === id);
  if (!s) throw new Error(`no Stripe Checkout session ${id}`);
  return s;
}

async function deliver(page: Page, event: string): Promise<{ result: string }> {
  const res = await page.context().request.post("/api/bookings/payments/webhook", {
    data: event,
    headers: { "content-type": "application/json", "stripe-signature": stripeSignature(event) },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { result: string };
}

const offered = (page: Page, value: string) =>
  page.locator(`input[name="slot"][value="${value.replace(/"/g, '\\"')}"]`);

test.describe.serial("payment at booking time (Stripe Checkout)", () => {
  test("a customer pays the deposit by card on Stripe Checkout when booking: the time is held until the signed webhook confirms the booking and the confirmation email is sent", async ({
    browser,
  }) => {
    const email = `payer-${stamp}@example.com`;
    const day = openDay(0);
    const page = await anonymous(browser);
    const checkout = await standInCheckout(page);
    await page.goto(`/book?${new URLSearchParams({ service: service.name, day })}`);
    await expect(page.getByTestId("pay-note")).toContainText("by card");
    const value = await bookUntilCheckout(page, day, email);

    // The session carries the server's amount and the booking; it expires when the hold ends.
    const s = await sessionOf(page);
    expect(s.params.mode).toBe("payment");
    expect(s.params["payment_method_types[0]"]).toBe("card");
    expect(s.params["line_items[0][price_data][unit_amount]"]).toBe(String(due.cents));
    expect(s.params["line_items[0][price_data][currency]"]).toBe(due.currency);
    expect(s.params.customer_email).toBe(email);
    const expiresIn = Number(s.params.expires_at) - Date.now() / 1000;
    expect(expiresIn).toBeGreaterThan(depositConfig.holdMinutes * 60 - 120);
    expect(expiresIn).toBeLessThanOrEqual(depositConfig.holdMinutes * 60 + 5);
    const [held] = await sql<{ status: string; reference: string }>(
      "select status, reference from booking_appointments where id = $1",
      [s.client_reference_id],
    );
    expect(held?.status, "the booking waits for its payment").toBe("pending_payment");
    expect(
      outbox().filter((m) => m.to === email),
      "no confirmation before payment",
    ).toHaveLength(0);

    // While the customer pays, nobody else is offered that time.
    const other = await anonymous(browser);
    await other.goto(`/book?${new URLSearchParams({ service: service.name, day })}`);
    const [time, resource] = value.split("|");
    await expect(other.getByRole("radio", { name: `${time} with ${resource}` })).toHaveCount(0);
    await other.context().close();

    await page.getByLabel("Card number").fill("4242 4242 4242 4242");
    await page.getByRole("button", { name: "Pay" }).click();
    await page.waitForURL(/\/book\/paid\?/);
    expect(checkout.card(), "the card is entered on Stripe's page, never in this app").toBe(
      "4242 4242 4242 4242",
    );
    await expect(page.getByTestId("booked")).toContainText(`Reference ${held?.reference}`);
    await expect(page.getByTestId("paid")).toContainText("received");

    // Stripe may deliver the event again: confirmed and emailed exactly once.
    expect((await deliver(page, sessionEvent(s, "completed"))).result).toBe("already processed");
    const [after] = await sql<{ status: string; payment: string; amount: number }>(
      `select a.status, p.status as payment, p.amount_cents as amount from booking_appointments a
       join booking_payments p on p.appointment_id = a.id where a.id = $1`,
      [s.client_reference_id],
    );
    expect(after).toEqual({ status: "confirmed", payment: "paid", amount: due.cents });
    const mails = outbox().filter(
      (m) => m.to === email && m.subject.includes(`${held?.reference} is confirmed`),
    );
    expect(mails).toHaveLength(1);
    expect(mails[0]?.link).toMatch(/\/book\/cancel\/[\w-]{20,}$/);
    await page.context().close();
  });

  test("an unpaid booking frees its time when the payment expires: Stripe's expired event releases it and the time is offered again", async ({
    browser,
  }) => {
    const day = openDay(1);
    const page = await anonymous(browser);
    await standInCheckout(page);
    const value = await bookUntilCheckout(page, day, `abandon-${stamp}@example.com`);
    const s = await sessionOf(page);
    expect((await deliver(page, sessionEvent(s, "expired"))).result).toBe("released");
    const [row] = await sql<{ status: string }>(
      "select status from booking_appointments where id = $1",
      [s.client_reference_id],
    );
    expect(row?.status).toBe("expired");
    await page.goto(`/book?${new URLSearchParams({ service: service.name, day })}`);
    await expect(offered(page, value), "the released time is offered again").toHaveCount(1);
    // Returning to the success page later says so, and nothing was confirmed.
    await page.goto(
      `/book/paid?${new URLSearchParams({ ref: String(s.params["metadata[booking_reference]"]), session_id: s.id })}`,
    );
    await expect(page.getByTestId("not-held")).toBeVisible();
    await page.context().close();
  });

  test("a hold whose time ran out is released when someone else books that time, and a payment arriving afterwards is refunded instead of double-booking", async ({
    browser,
  }) => {
    const day = openDay(2);
    const late = await anonymous(browser);
    await standInCheckout(late);
    const value = await bookUntilCheckout(late, day, `late-payer-${stamp}@example.com`);
    const s = await sessionOf(late);
    // The hold ends (as if the customer left the payment page open past its expiry).
    await sql(
      "update booking_appointments set hold_expires_at = now() - interval '1 minute' where id = $1",
      [s.client_reference_id],
    );
    const next = await anonymous(browser);
    await next.goto(`/book?${new URLSearchParams({ service: service.name, day })}`);
    await expect(offered(next, value), "an expired hold no longer blocks the time").toHaveCount(1);
    await standInCheckout(next);
    await next.locator(`input[name="slot"][value="${value}"]`).check();
    await next.getByLabel("Name").fill("Next Customer");
    await next.getByLabel("Email").fill(`next-${stamp}@example.com`);
    await next.getByLabel("Phone").fill("+34 600 000 003");
    await next.getByRole("button", { name: "Book", exact: true }).click();
    await next.waitForURL(/checkout\.stripe\.com/);

    expect((await deliver(late, sessionEvent(s, "completed"))).result).toBe("refunded");
    const refunds = (await (
      await fetch(`${process.env.STRIPE_API_BASE ?? ""}/__refunds`)
    ).json()) as { params: Record<string, string> }[];
    expect(refunds.some((r) => r.params.payment_intent === `pi_test_${s.id.slice(8, 30)}`)).toBe(
      true,
    );
    const [row] = await sql<{ status: string }>(
      "select status from booking_appointments where id = $1",
      [s.client_reference_id],
    );
    expect(row?.status, "the late payer's booking is not confirmed").toBe("expired");
    for (const p of [late, next]) await p.context().close();
  });

  test("the payment webhook refuses events without a valid Stripe signature and never confirms a different amount", async ({
    browser,
  }) => {
    const page = await anonymous(browser);
    const forged = await page.context().request.post("/api/bookings/payments/webhook", {
      data: JSON.stringify({
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_x" } },
      }),
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
    });
    expect(forged.status()).toBe(400);

    await standInCheckout(page);
    await bookUntilCheckout(page, openDay(3), `cheap-${stamp}@example.com`);
    const s = await sessionOf(page);
    const cheaper = {
      ...s,
      params: { ...s.params, "line_items[0][price_data][unit_amount]": "1" },
    };
    expect((await deliver(page, sessionEvent(cheaper, "completed"))).result).toBe(
      "amount mismatch",
    );
    const [row] = await sql<{ status: string }>(
      "select status from booking_appointments where id = $1",
      [s.client_reference_id],
    );
    expect(row?.status).toBe("pending_payment");
    await page.context().close();
  });
});

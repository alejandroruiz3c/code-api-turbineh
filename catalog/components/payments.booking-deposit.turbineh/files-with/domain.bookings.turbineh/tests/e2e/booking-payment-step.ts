import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/**
 * Submits the public booking form and, when the service needs a payment (payments.booking-deposit.turbineh), pays on
 * an offline stand-in of Stripe's hosted Checkout page: the card is typed there, Stripe's signed
 * checkout.session.completed event is delivered to the app's webhook, and the customer returns to the success URL —
 * the order Stripe follows. Replaces the bookings suite's default (no payment step), so its tests run unchanged.
 */
export interface StripeSession {
  id: string;
  client_reference_id: string | null;
  params: Record<string, string>;
}

export async function stripeSessions(): Promise<StripeSession[]> {
  const res = await fetch(`${process.env.STRIPE_API_BASE ?? ""}/__sessions`);
  return (await res.json()) as StripeSession[];
}

/** Signs a webhook body exactly like Stripe does (t=…,v1=HMAC-SHA256 of "t.body"). */
export function stripeSignature(body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** The event Stripe sends for a session (completed and paid, or expired), with the session's own amount. */
export function sessionEvent(s: StripeSession, type: "completed" | "expired"): string {
  return JSON.stringify({
    id: `evt_test_${s.id.slice(8, 24)}`,
    type: `checkout.session.${type}`,
    data: {
      object: {
        id: s.id,
        object: "checkout.session",
        client_reference_id: s.client_reference_id,
        payment_status: type === "completed" ? "paid" : "unpaid",
        status: type === "completed" ? "complete" : "expired",
        amount_total: Number(s.params["line_items[0][price_data][unit_amount]"]),
        currency: s.params["line_items[0][price_data][currency]"],
        payment_intent: type === "completed" ? `pi_test_${s.id.slice(8, 30)}` : null,
      },
    },
  });
}

/** Answers checkout.stripe.com for this page: a card form; paying delivers the signed event, then returns. */
export async function standInCheckout(page: Page): Promise<{ card: () => string }> {
  let card = "";
  await page.route("https://checkout.stripe.com/**", async (route) => {
    const id = /cs_test_[A-Za-z0-9]+/.exec(new URL(route.request().url()).pathname)?.[0] ?? "";
    if (route.request().method() === "GET")
      return route.fulfill({
        contentType: "text/html",
        body: `<form method="post" action="/c/pay/${id}/confirm"><label>Card number <input name="card" /></label><button>Pay</button></form>`,
      });
    card = new URLSearchParams(route.request().postData() ?? "").get("card") ?? "";
    const s = (await stripeSessions()).find((x) => x.id === id);
    if (!s) throw new Error(`no Stripe Checkout session ${id}`);
    const event = sessionEvent(s, "completed");
    const res = await page.context().request.post("/api/bookings/payments/webhook", {
      data: event,
      headers: { "content-type": "application/json", "stripe-signature": stripeSignature(event) },
    });
    expect(res.status()).toBe(200);
    return route.fulfill({
      status: 303,
      headers: { location: (s.params.success_url ?? "").replace("{CHECKOUT_SESSION_ID}", id) },
    });
  });
  return { card: () => card };
}

export async function submitBooking(page: Page): Promise<void> {
  await standInCheckout(page);
  await page.getByRole("button", { name: "Book", exact: true }).click();
  const booked = page.locator('[data-testid="booked"], form[aria-label="Book"] [role="alert"]');
  // Whichever comes first: Stripe's page (payment step) or the form's answer (no payment due, or refused).
  await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/).catch(() => undefined),
    booked
      .first()
      .waitFor()
      .catch(() => undefined),
  ]);
  if (!page.url().includes("checkout.stripe.com")) return;
  await page.getByLabel("Card number").fill("4242 4242 4242 4242");
  await page.getByRole("button", { name: "Pay" }).click();
  await page.waitForURL(/\/book\/paid\?/);
}

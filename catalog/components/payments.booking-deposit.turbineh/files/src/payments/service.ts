import { and, eq } from "drizzle-orm";
import { bookingConfig as cfg } from "@/bookings/config";
import type { HeldBooking } from "@/bookings/payment";
import { confirmHeldAppointment, PolicyError, releaseHeldAppointment } from "@/bookings/service";
import { db } from "@/db/client";
import { bookingAppointments, bookingPayments, bookingResources } from "@/db/schema";
import { env } from "@/env";
import { describeLocal } from "@/bookings/time";
import { amountDue, checkoutForm, HOLD_GRACE_MINUTES, verifyStripeSignature } from "./deposit";
import { depositConfig } from "./config";
import { payEnv, stripePost } from "./stripe";

/** Payment step of the public booking page (component payments.booking-deposit.turbineh). */
const serviceNamed = (name: string) => cfg.services.find((s) => s.name === name) ?? null;

/** What booking `service` costs now, or null when it is booked without payment. */
export function dueFor(service: string) {
  const s = serviceNamed(service);
  return s ? amountDue(s, depositConfig) : null;
}

/** The time stays held for the Checkout session's lifetime plus a grace period (Stripe never pays after expiry). */
export const holdMinutes = () => depositConfig.holdMinutes + HOLD_GRACE_MINUTES;

const appUrl = () => env.BETTER_AUTH_URL.replace(/\/+$/, "");

/**
 * Opens a Stripe Checkout session for a held booking: the amount comes from the server's rules, the session expires
 * when the hold ends, and the booking id travels as client_reference_id. Returns Stripe's hosted page URL.
 */
export async function startDepositCheckout(b: HeldBooking, now = new Date()): Promise<string> {
  const due = dueFor(b.service);
  if (!due) throw new Error(`no payment is due for ${b.service}`);
  if (!payEnv.STRIPE_SECRET_KEY)
    throw new PolicyError(
      `Online payment is not set up yet. Please contact ${cfg.business} to book.`,
    );
  const expiresAt = Math.floor(now.getTime() / 1000) + depositConfig.holdMinutes * 60;
  const session = await stripePost(
    "/v1/checkout/sessions",
    checkoutForm({
      appointmentId: b.id,
      reference: b.reference,
      business: cfg.business,
      service: b.service,
      when: b.when,
      email: b.email,
      cents: due.cents,
      currency: due.currency,
      kind: due.kind,
      expiresAt,
      successUrl: `${appUrl()}/book/paid?ref=${b.reference}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl()}/book?${new URLSearchParams({ service: b.service })}`,
    }),
    `booking-${b.id}`,
  );
  const id = typeof session.id === "string" ? session.id : "";
  const url = typeof session.url === "string" ? session.url : "";
  // Only Stripe's own hosted page (constant host) is ever opened.
  if (!/^cs_/.test(id) || new URL(url).hostname !== "checkout.stripe.com")
    throw new Error("unexpected Stripe Checkout session");
  await db.insert(bookingPayments).values({
    appointmentId: b.id,
    sessionId: id,
    kind: due.kind,
    amountCents: due.cents,
    currency: due.currency,
  });
  return url;
}

interface CheckoutSessionEvent {
  type?: string;
  data?: {
    object?: {
      id?: unknown;
      client_reference_id?: unknown;
      payment_status?: unknown;
      amount_total?: unknown;
      currency?: unknown;
      payment_intent?: unknown;
    };
  };
}

export type WebhookOutcome =
  { status: 400 | 503; body: string } | { status: 200; body: { received: true; result: string } };

/**
 * Stripe webhook of the payment step: the only place a held booking becomes confirmed (or is released).
 * - checkout.session.completed + paid, for exactly the amount and currency recorded → confirmed, confirmation email;
 * - checkout.session.expired → the time is freed;
 * - a payment for a time that is no longer held (released before it arrived) is refunded, never double-booked.
 * Signed (Stripe-Signature, 5-minute tolerance) and idempotent: Stripe may deliver an event more than once.
 */
export async function handleStripeEvent(
  raw: string,
  signature: string | null,
): Promise<WebhookOutcome> {
  if (!payEnv.STRIPE_WEBHOOK_SECRET) return { status: 503, body: "Webhook not configured" };
  if (!verifyStripeSignature(raw, signature, payEnv.STRIPE_WEBHOOK_SECRET))
    return { status: 400, body: "Invalid signature" };
  const event = JSON.parse(raw) as CheckoutSessionEvent;
  const s = event.data?.object ?? {};
  const sessionId = typeof s.id === "string" ? s.id : "";
  const done = (result: string): WebhookOutcome => ({
    status: 200,
    body: { received: true, result },
  });
  if (!sessionId) return done("ignored");
  const [p] = await db
    .select()
    .from(bookingPayments)
    .where(eq(bookingPayments.sessionId, sessionId));
  if (
    !p ||
    (typeof s.client_reference_id === "string" && s.client_reference_id !== p.appointmentId)
  )
    return done("unknown session");
  if (event.type === "checkout.session.expired") {
    await db
      .update(bookingPayments)
      .set({ status: "expired" })
      .where(and(eq(bookingPayments.id, p.id), eq(bookingPayments.status, "open")));
    await releaseHeldAppointment(p.appointmentId);
    return done("released");
  }
  if (event.type !== "checkout.session.completed" || s.payment_status !== "paid")
    return done("ignored");
  // Stripe charged exactly what the server computed, or nothing is confirmed.
  if (s.amount_total !== p.amountCents || String(s.currency ?? "").toLowerCase() !== p.currency)
    return done("amount mismatch");
  const paymentIntent = typeof s.payment_intent === "string" ? s.payment_intent : null;
  const [paid] = await db
    .update(bookingPayments)
    .set({ status: "paid", paidAt: new Date(), paymentIntent })
    .where(and(eq(bookingPayments.id, p.id), eq(bookingPayments.status, "open")))
    .returning({ id: bookingPayments.id });
  if (!paid) return done("already processed");
  if (await confirmHeldAppointment(p.appointmentId)) return done("confirmed");
  // The time was released before the payment arrived: give the money back instead of double-booking.
  if (paymentIntent) {
    const form = new URLSearchParams({
      payment_intent: paymentIntent,
      reason: "requested_by_customer",
    });
    await stripePost("/v1/refunds", form, `refund-${p.id}`);
  }
  await db.update(bookingPayments).set({ status: "refunded" }).where(eq(bookingPayments.id, p.id));
  return done("refunded");
}

/** The booking a Checkout return belongs to: reference and the session id Stripe appended must both match. */
export async function returnedBooking(reference: string, sessionId: string) {
  if (!/^[A-Z0-9]{8}$/.test(reference) || !/^cs_[A-Za-z0-9_]{1,250}$/.test(sessionId)) return null;
  const [row] = await db
    .select({ a: bookingAppointments, p: bookingPayments, resource: bookingResources.name })
    .from(bookingPayments)
    .innerJoin(bookingAppointments, eq(bookingAppointments.id, bookingPayments.appointmentId))
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(
      and(eq(bookingPayments.sessionId, sessionId), eq(bookingAppointments.reference, reference)),
    );
  if (!row) return null;
  return {
    reference: row.a.reference,
    status: row.a.status,
    payment: row.p.status,
    amountCents: row.p.amountCents,
    currency: row.p.currency,
    kind: row.p.kind,
    service: row.a.service,
    resource: row.resource,
    when: `${describeLocal(row.a.startsAt, cfg.timeZone)} (${cfg.timeZone})`,
    email: row.a.customerEmail,
  };
}

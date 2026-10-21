import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Payment at booking time (component payments.booking-deposit.turbineh): what a booking costs to secure, computed on
 * the server from src/payments/booking-deposit.json and the services of src/bookings/params.json — never from the
 * browser. Pure functions (unit-tested without network or database); the parsed params live in config.ts.
 */
export const DepositParams = z
  .object({
    /** "deposit": a part of the price (fixed amount or percent); "full": the service's whole price. */
    mode: z.enum(["deposit", "full"]),
    /** Deposit as a percent of the service price (1–100), when no fixed amount is set. */
    percent: z.number().min(1).max(100).nullable(),
    /** Fixed deposit per booking (major units, e.g. 10 = 10 €); in "full" mode, the price of unpriced services. */
    amount: z.number().min(0.5).max(100_000).nullable(),
    /** Currency of `amount` and of services without one (ISO code, lowercase). */
    currency: z.string().regex(/^[a-z]{3}$/),
    /** Stripe Checkout session lifetime: the time stays held this long (Stripe allows 30 minutes to 24 hours). */
    holdMinutes: z.number().int().min(30).max(1440),
  })
  .superRefine((p, ctx) => {
    if (p.mode === "deposit" && p.amount === null && p.percent === null)
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "a deposit needs an amount or a percent",
      });
  });

export type DepositConfig = z.infer<typeof DepositParams>;

/** Minutes the booking stays held after Stripe's session expires: Stripe never completes a payment after expiry. */
export const HOLD_GRACE_MINUTES = 5;

export interface PricedService {
  name: string;
  price: number | null;
  currency: string | null;
}

const toCents = (major: number) => Math.round(major * 100);

/** ISO code of a service currency written as a code or a symbol ("EUR", "€", "usd"…), else the params' currency. */
export function currencyOf(service: PricedService, cfg: DepositConfig): string {
  const c = (service.currency ?? "").trim().toLowerCase();
  if (c === "€" || c === "eur") return "eur";
  if (c === "$" || c === "usd") return "usd";
  if (c === "£" || c === "gbp") return "gbp";
  return /^[a-z]{3}$/.test(c) ? c : cfg.currency;
}

/**
 * The amount to pay when booking `service` (integer cents), or null when it is booked without payment (no price and
 * nothing to charge). A fixed deposit never exceeds the service price; a percent is rounded half up to the cent.
 */
export function amountDue(
  service: PricedService,
  cfg: DepositConfig,
): { cents: number; currency: string; kind: "deposit" | "full" } | null {
  const currency = currencyOf(service, cfg);
  const price = service.price !== null && service.price > 0 ? toCents(service.price) : null;
  if (cfg.mode === "full") {
    const cents = price ?? (cfg.amount !== null ? toCents(cfg.amount) : null);
    return cents ? { cents, currency, kind: "full" } : null;
  }
  if (cfg.amount !== null) {
    const fixed = toCents(cfg.amount);
    const cents = price !== null ? Math.min(fixed, price) : fixed;
    return cents > 0
      ? { cents, currency, kind: price !== null && cents === price ? "full" : "deposit" }
      : null;
  }
  if (price === null || cfg.percent === null) return null;
  const cents = Math.floor((price * cfg.percent) / 100 + 0.5);
  return cents > 0 ? { cents, currency, kind: cfg.percent === 100 ? "full" : "deposit" } : null;
}

/** "10,00 €" in the shop's locale. */
export const formatMoney = (cents: number, currency: string): string =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

export interface CheckoutRequest {
  appointmentId: string;
  reference: string;
  business: string;
  service: string;
  when: string;
  email: string;
  cents: number;
  currency: string;
  kind: "deposit" | "full";
  /** Unix seconds; Stripe requires 30 minutes to 24 hours from now. */
  expiresAt: number;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Form body for POST /v1/checkout/sessions (https://docs.stripe.com/api/checkout/sessions/create), payment mode,
 * cards only: one line with the server's amount, the booking as client_reference_id, and an expiry that ends the hold.
 */
export function checkoutForm(r: CheckoutRequest): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("payment_method_types[0]", "card");
  f.set("success_url", r.successUrl);
  f.set("cancel_url", r.cancelUrl);
  f.set("client_reference_id", r.appointmentId);
  f.set("customer_email", r.email);
  f.set("expires_at", String(r.expiresAt));
  f.set("metadata[booking_reference]", r.reference);
  f.set("payment_intent_data[metadata][booking_reference]", r.reference);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", r.currency);
  f.set("line_items[0][price_data][unit_amount]", String(r.cents));
  f.set(
    "line_items[0][price_data][product_data][name]",
    `${r.kind === "deposit" ? "Deposit: " : ""}${r.service} — ${r.business}`.slice(0, 250),
  );
  f.set(
    "line_items[0][price_data][product_data][description]",
    `Booking ${r.reference}, ${r.when}`.slice(0, 500),
  );
  return f;
}

/**
 * Stripe-Signature check (https://docs.stripe.com/webhooks#verify-manually): HMAC-SHA256 of "t.body" with the
 * endpoint secret, constant-time compare, 5-minute tolerance against replays.
 */
export function verifyStripeSignature(
  raw: string,
  header: string | null,
  secret: string,
  now = Date.now(),
  toleranceSeconds = 300,
): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  return parts
    .filter(([k]) => k === "v1")
    .some(([, v]) => {
      const got = Buffer.from(v ?? "", "hex");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

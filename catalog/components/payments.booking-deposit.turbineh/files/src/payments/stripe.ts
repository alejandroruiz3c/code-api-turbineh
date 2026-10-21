import { z } from "zod";

/**
 * Stripe settings of the payment step (component payments.booking-deposit.turbineh). Read once from the environment;
 * secrets only from there. Without STRIPE_SECRET_KEY bookings that need a payment are refused with a clear message
 * (never confirmed unpaid).
 */
export const payEnv = z
  .object({
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    STRIPE_API_BASE: z.url().default("https://api.stripe.com"),
  })
  .parse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || undefined,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    STRIPE_API_BASE: process.env.STRIPE_API_BASE || undefined,
  });

/** POST to Stripe's documented REST API (form-encoded), with an idempotency key. */
export async function stripePost(
  path: string,
  form: URLSearchParams,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  if (!payEnv.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  const res = await fetch(`${payEnv.STRIPE_API_BASE.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${payEnv.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey,
    },
    body: form,
  });
  const body = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${body.error?.message ?? res.status}`);
  return body;
}

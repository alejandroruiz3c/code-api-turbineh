import { env } from "@/env";
import { checkoutForm, type CheckoutInput } from "@/lib/checkout";

/**
 * Stripe Checkout (hosted payment page) through the documented REST API — no card data ever reaches this app.
 * https://docs.stripe.com/api/checkout/sessions/create
 *
 * The body is built by checkoutForm() from the server-side quote, so Stripe charges exactly the order total.
 */
export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("payments are not configured");
  const res = await fetch(`${env.STRIPE_API_BASE.replace(/\/$/, "")}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `checkout-${input.orderId}`,
    },
    body: checkoutForm(input),
  });
  const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.id || !body.url)
    throw new Error(`Stripe: ${body.error?.message ?? res.status}`);
  return { id: body.id, url: body.url };
}

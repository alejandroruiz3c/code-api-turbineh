import { env } from "@/env";

/**
 * Stripe Checkout (hosted payment page) through the documented REST API — no card data ever reaches this app.
 * https://docs.stripe.com/api/checkout/sessions/create
 */
export async function createCheckoutSession(input: {
  orderId: string;
  lines: { name: string; unitPriceCents: number; quantity: number }[];
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("payments are not configured");
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("client_reference_id", input.orderId);
  form.set("metadata[order_id]", input.orderId);
  input.lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.quantity));
    form.set(`line_items[${i}][price_data][currency]`, env.SHOP_CURRENCY);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.unitPriceCents));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `checkout-${input.orderId}`,
    },
    body: form,
  });
  const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !body.id || !body.url)
    throw new Error(`Stripe: ${body.error?.message ?? res.status}`);
  return { id: body.id, url: body.url };
}

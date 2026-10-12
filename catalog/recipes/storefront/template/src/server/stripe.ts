import { env } from "@/env";
import { formatRate } from "@/lib/shop";
import type { Quote } from "@/server/cart";

/**
 * Stripe Checkout (hosted payment page) through the documented REST API — no card data ever reaches this app.
 * https://docs.stripe.com/api/checkout/sessions/create
 *
 * Amounts come from the server-side quote, so Stripe charges exactly the order total: product lines, the chosen
 * shipping option (address restricted to the quoted country) and, when prices exclude tax, one tax line.
 */
export async function createCheckoutSession(input: {
  orderId: string;
  lines: { name: string; unitPriceCents: number; quantity: number }[];
  quote: Quote;
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
  const lines = [...input.lines];
  const { quote } = input;
  if (!quote.pricesIncludeTax && quote.taxCents > 0 && quote.tax) {
    lines.push({
      name: `${quote.tax.label} (${formatRate(quote.tax.rateBp)})`,
      unitPriceCents: quote.taxCents,
      quantity: 1,
    });
  }
  lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.quantity));
    form.set(`line_items[${i}][price_data][currency]`, env.SHOP_CURRENCY);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.unitPriceCents));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });
  if (quote.shipping && quote.country) {
    const rate = "shipping_options[0][shipping_rate_data]";
    form.set(`${rate}[display_name]`, quote.shipping.name);
    form.set(`${rate}[type]`, "fixed_amount");
    form.set(`${rate}[fixed_amount][amount]`, String(quote.shippingCents));
    form.set(`${rate}[fixed_amount][currency]`, env.SHOP_CURRENCY);
    form.set("shipping_address_collection[allowed_countries][0]", quote.country);
  }
  const res = await fetch(`${env.STRIPE_API_BASE.replace(/\/$/, "")}/v1/checkout/sessions`, {
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

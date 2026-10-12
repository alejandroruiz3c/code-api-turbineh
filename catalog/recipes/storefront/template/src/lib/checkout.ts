import { formatPrice, formatRate } from "@/lib/shop";

/** Everything Stripe Checkout needs, computed on the server (pure: unit-tested without network). */
export interface CheckoutInput {
  orderId: string;
  currency: string;
  lines: { name: string; unitPriceCents: number; quantity: number }[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string | null;
  shipping: { name: string; cents: number } | null;
  country: string | null;
  /** Manual tax line, only when prices exclude tax (with prices including tax it is already in the amounts). */
  tax: { label: string; rateBp: number; cents: number } | null;
  taxMode: "manual" | "stripe";
  pricesIncludeTax: boolean;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Form body for POST /v1/checkout/sessions (https://docs.stripe.com/api/checkout/sessions/create).
 *
 * Stripe always charges exactly our quote:
 * - without a discount, one line per product line;
 * - with a discount code, ONE line with the discounted goods total (its description lists the items and the code):
 *   spreading a discount over lines with quantities cannot always be exact to the cent, and Stripe coupons would be
 *   extra objects in the client's account;
 * - shipping as the chosen fixed-amount option (address limited to the quoted country);
 * - manual taxes excluded from prices: one tax line. Stripe Tax: automatic_tax, every amount marked inclusive or
 *   exclusive, and an address is always collected (Stripe needs it to compute tax).
 */
export function checkoutForm(i: CheckoutInput): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", i.successUrl);
  form.set("cancel_url", i.cancelUrl);
  form.set("client_reference_id", i.orderId);
  form.set("metadata[order_id]", i.orderId);
  const behavior = i.pricesIncludeTax ? "inclusive" : "exclusive";
  const lines: { name: string; description?: string; unitPriceCents: number; quantity: number }[] =
    i.discountCents > 0
      ? [
          {
            name: `Order ${i.orderId.slice(0, 8).toUpperCase()}`,
            description: [
              ...i.lines.map((l) => `${l.quantity} × ${l.name}`),
              `Discount${i.couponCode ? ` ${i.couponCode}` : ""}: −${formatPrice(i.discountCents, i.currency)}`,
            ]
              .join(" · ")
              .slice(0, 500),
            unitPriceCents: i.subtotalCents - i.discountCents,
            quantity: 1,
          },
        ]
      : [...i.lines];
  if (i.taxMode === "manual" && !i.pricesIncludeTax && i.tax && i.tax.cents > 0) {
    lines.push({
      name: `${i.tax.label} (${formatRate(i.tax.rateBp)})`,
      unitPriceCents: i.tax.cents,
      quantity: 1,
    });
  }
  lines.forEach((l, n) => {
    const p = `line_items[${n}][price_data]`;
    form.set(`line_items[${n}][quantity]`, String(l.quantity));
    form.set(`${p}[currency]`, i.currency);
    form.set(`${p}[unit_amount]`, String(l.unitPriceCents));
    form.set(`${p}[product_data][name]`, l.name);
    if (l.description) form.set(`${p}[product_data][description]`, l.description);
    if (i.taxMode === "stripe") form.set(`${p}[tax_behavior]`, behavior);
  });
  if (i.shipping && i.country) {
    const rate = "shipping_options[0][shipping_rate_data]";
    form.set(`${rate}[display_name]`, i.shipping.name);
    form.set(`${rate}[type]`, "fixed_amount");
    form.set(`${rate}[fixed_amount][amount]`, String(i.shipping.cents));
    form.set(`${rate}[fixed_amount][currency]`, i.currency);
    if (i.taxMode === "stripe") form.set(`${rate}[tax_behavior]`, behavior);
    form.set("shipping_address_collection[allowed_countries][0]", i.country);
  }
  if (i.taxMode === "stripe") {
    form.set("automatic_tax[enabled]", "true");
    if (!i.shipping) form.set("billing_address_collection", "required");
  }
  return form;
}

import { describe, expect, it } from "vitest";
import { checkoutForm, type CheckoutInput } from "@/lib/checkout";
import { checkoutCountries } from "@/lib/countries";
import {
  cartTotal,
  COUPON_CODE,
  couponDiscount,
  describeCoupon,
  formatPrice,
  formatRate,
  imageType,
  normalizeCode,
  orderSummary,
  orderTotals,
  parseCountries,
  parsePrice,
  parseRatePercent,
  pickCurrency,
  priceIn,
  shippingCost,
  shipsTo,
  shopCurrencies,
  signStripePayload,
  stripePaidAmounts,
  taxFor,
  verifyStripeSignature,
  type Coupon,
} from "@/lib/shop";

const SECRET = "whsec_test_secret_for_unit_tests";

describe("shop rules", () => {
  it("accepts only correctly signed, recent Stripe webhooks", () => {
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const now = 1_800_000_000;
    const header = signStripePayload(body, SECRET, now);
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(true);
    expect(verifyStripeSignature(`${body} `, header, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", now)).toBe(false);
    expect(verifyStripeSignature(body, header, SECRET, now + 3600)).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET, now)).toBe(false);
  });

  it("parses prices into integer cents", () => {
    expect(parsePrice("19.90")).toBe(1990);
    expect(parsePrice("19,9")).toBe(1990);
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice("-5")).toBeNull();
    expect(parsePrice("1e3")).toBeNull();
  });

  it("totals carts exactly and formats money", () => {
    expect(
      cartTotal([
        { unitPriceCents: 1990, quantity: 3 },
        { unitPriceCents: 10, quantity: 1 },
      ]),
    ).toBe(5980);
    expect(formatPrice(5980, "eur")).toContain("59.80");
  });

  it("detects product image types by content", () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(imageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("adds tax on top when prices exclude it, rounding half up once on the total", () => {
    // 49.90 × 2 + 4.90 shipping = 104.70; 21 % = 21.987 → 21.99
    expect(
      orderTotals({
        subtotalCents: 9980,
        shippingCents: 490,
        rateBp: 2100,
        pricesIncludeTax: false,
      }),
    ).toEqual({
      subtotalCents: 9980,
      discountCents: 0,
      shippingCents: 490,
      taxCents: 2199,
      totalCents: 12669,
    });
    // exactly half a cent rounds up: 0.50 × 1 % = 0.005
    expect(
      orderTotals({ subtotalCents: 50, shippingCents: 0, rateBp: 100, pricesIncludeTax: false })
        .taxCents,
    ).toBe(1);
  });

  it("extracts the tax contained in tax-inclusive prices without changing the total", () => {
    // 121.00 at 21 % contains exactly 21.00
    expect(
      orderTotals({ subtotalCents: 12100, shippingCents: 0, rateBp: 2100, pricesIncludeTax: true }),
    ).toEqual({
      subtotalCents: 12100,
      discountCents: 0,
      shippingCents: 0,
      taxCents: 2100,
      totalCents: 12100,
    });
    // 99.80 + 4.90 = 104.70 → net 86.53 (86.5289…), tax 18.17
    expect(
      orderTotals({
        subtotalCents: 9980,
        shippingCents: 490,
        rateBp: 2100,
        pricesIncludeTax: true,
      }),
    ).toMatchObject({ taxCents: 1817, totalCents: 10470 });
    expect(
      orderTotals({ subtotalCents: 1000, shippingCents: 0, rateBp: 0, pricesIncludeTax: true }),
    ).toMatchObject({ taxCents: 0, totalCents: 1000 });
  });

  it("parses tax rates and country lists strictly", () => {
    expect(parseRatePercent("21")).toBe(2100);
    expect(parseRatePercent("7,75")).toBe(775);
    expect(parseRatePercent("100")).toBe(10000);
    expect(parseRatePercent("101")).toBeNull();
    expect(parseRatePercent("-1")).toBeNull();
    expect(formatRate(2100)).toBe("21 %");
    expect(formatRate(775)).toBe("7.75 %");
    expect(parseCountries("es, pt ;FR es")).toEqual(["ES", "PT", "FR"]);
    expect(parseCountries("")).toEqual([]);
    expect(parseCountries("ESP")).toBeNull();
  });

  it("applies shipping by country with an optional free threshold", () => {
    const rate = {
      id: "r",
      name: "Standard",
      countries: "ES,PT",
      priceCents: 490,
      freeOverCents: 5000,
    };
    expect(shipsTo(rate, "es")).toBe(true);
    expect(shipsTo(rate, "FR")).toBe(false);
    expect(shipsTo({ countries: "" }, "FR")).toBe(true);
    expect(shippingCost(rate, 4999)).toBe(490);
    expect(shippingCost(rate, 5000)).toBe(0);
    expect(shippingCost({ ...rate, freeOverCents: null }, 100_000)).toBe(490);
    expect(checkoutCountries([rate])).toEqual(["PT", "ES"]); // sorted by name: Portugal, Spain
    expect(checkoutCountries([rate, { countries: "" }]).length).toBeGreaterThan(200);
  });

  it("picks the country's tax rate, else the default", () => {
    const rates = [
      { country: "ES", rateBp: 2100 },
      { country: "*", rateBp: 2000 },
    ];
    expect(taxFor(rates, "es")?.rateBp).toBe(2100);
    expect(taxFor(rates, "FR")?.rateBp).toBe(2000);
    expect(taxFor(rates.slice(0, 1), "FR")).toBeNull();
  });

  it("writes the order breakdown for emails", () => {
    const text = orderSummary(
      {
        currency: "eur",
        subtotalCents: 9980,
        shippingCents: 0,
        shippingName: "Standard",
        taxCents: 1732,
        taxLabel: "VAT (21 %)",
        pricesIncludeTax: true,
        totalCents: 9980,
      },
      [{ name: "Linen Shirt", variantName: "M / Blue", quantity: 2, unitPriceCents: 4990 }],
    );
    expect(text).toContain("2 × Linen Shirt — M / Blue");
    expect(text).toContain("Shipping (Standard): Free");
    expect(text).toContain("Includes VAT (21 %)");
    expect(text).toContain("Total: €99.80");
  });
});

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  code: "SUMMER10",
  kind: "percent",
  percentBp: 1000,
  amountCents: null,
  currency: null,
  minSubtotalCents: null,
  maxRedemptions: null,
  redemptions: 0,
  expiresAt: null,
  active: true,
  ...over,
});

describe("discount codes", () => {
  const now = new Date("2026-10-12T12:00:00Z");

  it("takes a percentage off goods, rounding half up, never more than the subtotal", () => {
    expect(couponDiscount(coupon(), 12180, "eur", now)).toEqual({ discountCents: 1218 });
    // 10 % of 0.05 = 0.005 → 0.01
    expect(couponDiscount(coupon(), 5, "eur", now)).toEqual({ discountCents: 1 });
    expect(couponDiscount(coupon({ percentBp: 10_000 }), 4990, "eur", now)).toEqual({
      discountCents: 4990,
    });
  });

  it("takes a fixed amount in its own currency only, capped at the subtotal", () => {
    const five = coupon({ kind: "amount", percentBp: null, amountCents: 500, currency: "eur" });
    expect(couponDiscount(five, 4990, "eur", now)).toEqual({ discountCents: 500 });
    expect(couponDiscount(five, 300, "eur", now)).toEqual({ discountCents: 300 });
    expect(couponDiscount(five, 4990, "usd", now)).toEqual({
      error: "This code is valid for payments in EUR only.",
    });
  });

  it("refuses inactive, expired, used-up and below-minimum codes", () => {
    expect(couponDiscount(coupon({ active: false }), 5000, "eur", now)).toHaveProperty("error");
    expect(
      couponDiscount(coupon({ expiresAt: new Date("2026-10-12T12:00:00Z") }), 5000, "eur", now),
    ).toEqual({ error: "This code has expired." });
    expect(couponDiscount(coupon({ maxRedemptions: 2, redemptions: 2 }), 5000, "eur", now)).toEqual(
      { error: "This code has been fully used." },
    );
    expect(
      couponDiscount(coupon({ currency: "eur", minSubtotalCents: 4000 }), 3999, "eur", now),
    ).toEqual({ error: "This code needs an order of at least €40.00." });
  });

  it("normalises codes and describes them", () => {
    expect(normalizeCode(" summer 10 ")).toBe("SUMMER10");
    expect(COUPON_CODE.test("SUMMER10")).toBe(true);
    expect(COUPON_CODE.test("A")).toBe(false);
    expect(COUPON_CODE.test("DROP;TABLE")).toBe(false);
    expect(describeCoupon(coupon())).toBe("10 % off");
    expect(
      describeCoupon(
        coupon({ kind: "amount", amountCents: 500, currency: "eur", minSubtotalCents: 4000 }),
      ),
    ).toBe("€5.00 off (from €40.00)");
  });

  it("computes totals with the discount before shipping and tax", () => {
    // 121.80 − 12.18 = 109.62 + 4.90 = 114.52, tax-inclusive at 21 % → contains 19.88
    expect(
      orderTotals({
        subtotalCents: 12180,
        discountCents: 1218,
        shippingCents: 490,
        rateBp: 2100,
        pricesIncludeTax: true,
      }),
    ).toEqual({
      subtotalCents: 12180,
      discountCents: 1218,
      shippingCents: 490,
      taxCents: 1988,
      totalCents: 11452,
    });
    // tax on top of the discounted base; a discount larger than the goods is capped
    expect(
      orderTotals({
        subtotalCents: 1000,
        discountCents: 5000,
        shippingCents: 500,
        rateBp: 1000,
        pricesIncludeTax: false,
      }),
    ).toMatchObject({ discountCents: 1000, taxCents: 50, totalCents: 550 });
  });
});

describe("currencies", () => {
  it("lists the base currency first and validates the buyer's choice", () => {
    expect(shopCurrencies("eur", " USD, gbp,eur,xx ")).toEqual(["eur", "usd", "gbp"]);
    expect(shopCurrencies("eur", "")).toEqual(["eur"]);
    expect(pickCurrency("USD", ["eur", "usd"])).toBe("usd");
    expect(pickCurrency("jpy", ["eur", "usd"])).toBe("eur");
    expect(pickCurrency(undefined, ["eur", "usd"])).toBe("eur");
  });

  it("uses explicit prices per currency, never exchange rates", () => {
    const base = { productBase: 2000, productLocal: 2400, variantLocal: null };
    expect(priceIn({ ...base, base: true, variant: false, variantBase: null })).toBe(2000);
    expect(priceIn({ ...base, base: true, variant: true, variantBase: 2200 })).toBe(2200);
    expect(priceIn({ ...base, base: false, variant: false, variantBase: null })).toBe(2400);
    // an option that inherits the product's price inherits it in every currency
    expect(priceIn({ ...base, base: false, variant: true, variantBase: null })).toBe(2400);
    // an option with its own base price needs its own price in the other currency
    expect(priceIn({ ...base, base: false, variant: true, variantBase: 2200 })).toBeNull();
    expect(
      priceIn({ ...base, base: false, variant: true, variantBase: 2200, variantLocal: 2600 }),
    ).toBe(2600);
    expect(
      priceIn({ ...base, productLocal: null, base: false, variant: false, variantBase: null }),
    ).toBeNull();
  });
});

describe("Stripe Checkout and Stripe Tax", () => {
  const input: CheckoutInput = {
    orderId: "0b5f2a9e-1111-4222-8333-944444444444",
    currency: "usd",
    lines: [
      { name: "Linen Shirt", unitPriceCents: 5400, quantity: 2 },
      { name: "Cotton Tee — L", unitPriceCents: 2400, quantity: 1 },
    ],
    subtotalCents: 13200,
    discountCents: 0,
    couponCode: null,
    shipping: { name: "US Standard", cents: 900 },
    country: "US",
    tax: { label: "Sales tax", rateBp: 800, cents: 1128 },
    taxMode: "manual",
    pricesIncludeTax: false,
    successUrl: "https://shop.test/ok",
    cancelUrl: "https://shop.test/cart",
  };
  const sum = (f: URLSearchParams) => {
    let total = 0;
    for (let n = 0; f.has(`line_items[${n}][quantity]`); n++)
      total +=
        Number(f.get(`line_items[${n}][quantity]`)) *
        Number(f.get(`line_items[${n}][price_data][unit_amount]`));
    return total + Number(f.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"));
  };

  it("charges exactly the quote: lines, shipping and the manual tax line, in the order's currency", () => {
    const f = checkoutForm(input);
    expect(f.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(f.get("line_items[2][price_data][product_data][name]")).toBe("Sales tax (8 %)");
    expect(sum(f)).toBe(13200 + 900 + 1128);
    expect(f.get("automatic_tax[enabled]")).toBeNull();
  });

  it("sends a discounted order as one exact line that names the code", () => {
    const f = checkoutForm({ ...input, discountCents: 1320, couponCode: "SUMMER10" });
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe("11880");
    expect(f.get("line_items[0][price_data][product_data][description]")).toContain(
      "Discount SUMMER10",
    );
    expect(sum(f)).toBe(13200 - 1320 + 900 + 1128);
  });

  it("lets Stripe Tax compute tax: automatic_tax, tax behaviour on every amount, no manual tax line", () => {
    const f = checkoutForm({ ...input, taxMode: "stripe", tax: null });
    expect(f.get("automatic_tax[enabled]")).toBe("true");
    expect(f.get("line_items[0][price_data][tax_behavior]")).toBe("exclusive");
    expect(f.get("shipping_options[0][shipping_rate_data][tax_behavior]")).toBe("exclusive");
    expect(f.has("line_items[2][quantity]")).toBe(false);
    const noShipping = checkoutForm({
      ...input,
      taxMode: "stripe",
      tax: null,
      shipping: null,
      pricesIncludeTax: true,
    });
    expect(noShipping.get("billing_address_collection")).toBe("required");
    expect(noShipping.get("line_items[0][price_data][tax_behavior]")).toBe("inclusive");
  });

  it("records Stripe Tax amounts only from a well-formed signed event in the order's currency", () => {
    const ok = { amount_total: 15228, currency: "usd", total_details: { amount_tax: 1128 } };
    expect(stripePaidAmounts(ok, "usd")).toEqual({ taxCents: 1128, totalCents: 15228 });
    expect(stripePaidAmounts({ ...ok, currency: "eur" }, "usd")).toBeNull();
    expect(stripePaidAmounts({ ...ok, amount_total: "15228" }, "usd")).toBeNull();
    expect(stripePaidAmounts({ ...ok, total_details: { amount_tax: 99_999 } }, "usd")).toBeNull();
    expect(stripePaidAmounts({ ...ok, amount_total: -1 }, "usd")).toBeNull();
  });
});

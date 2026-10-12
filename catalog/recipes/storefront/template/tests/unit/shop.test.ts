import { describe, expect, it } from "vitest";
import { checkoutCountries } from "@/lib/countries";
import {
  cartTotal,
  formatPrice,
  formatRate,
  imageType,
  orderSummary,
  orderTotals,
  parseCountries,
  parsePrice,
  parseRatePercent,
  shippingCost,
  shipsTo,
  signStripePayload,
  taxFor,
  verifyStripeSignature,
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
    ).toEqual({ subtotalCents: 9980, shippingCents: 490, taxCents: 2199, totalCents: 12669 });
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
    ).toEqual({ subtotalCents: 12100, shippingCents: 0, taxCents: 2100, totalCents: 12100 });
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

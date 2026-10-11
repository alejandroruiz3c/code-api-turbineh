import { describe, expect, it } from "vitest";
import {
  cartTotal,
  formatPrice,
  imageType,
  parsePrice,
  signStripePayload,
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
});

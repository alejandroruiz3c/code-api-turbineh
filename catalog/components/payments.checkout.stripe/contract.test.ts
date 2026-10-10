import { describe, expect, it } from "vitest";
import Stripe from "stripe";
describe("stripe contract", () => {
  it("verifies webhook signatures and rejects forged ones", () => {
    const stripe = new Stripe("sk_test_dummy");
    const secret = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_1",
      object: "event",
      type: "checkout.session.completed",
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).type).toBe(
      "checkout.session.completed",
    );
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_other")).toThrow();
  });
});

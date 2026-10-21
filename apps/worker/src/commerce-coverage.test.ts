import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { openDecider, type Decider } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { canonicalizeSpec, gateDomains, planCriteria } from "./pipeline.js";
import { gateRequest } from "./scope.js";

/**
 * Commerce and payments (ADR-0071): requests like the production ones of the shop and booking-payment demand —
 * synthetic, paraphrased fixtures (other businesses, other words) — map to the canonical criteria the storefront recipe
 * and payments.booking-deposit.turbineh prove, so the scope gate covers them by code and the functional coverage the
 * plan predicts is what the delivered tests prove.
 */
const repo = join(import.meta.dirname, "../../..");
const recipesDir = join(repo, "catalog/recipes");
const componentsDir = join(repo, "catalog/components");

/** A decider that judges every requirement outside the library: only code (tests) can cover them. */
const skeptic: Decider = {
  ...openDecider,
  scopeOutside: async (input) => ({
    outside: Object.fromEntries(input.requirements.map((r) => [r.index, true])),
    meta: { model: "fake", latencyMs: 1 },
  }),
};

const spec = (over: Partial<BuildSpec>): BuildSpec =>
  ({
    out_of_scope_reason: null,
    closest_recipe: null,
    slug: "app",
    roles: ["customer", "admin"],
    pages: [{ path: "/", purpose: "Home", auth_required: false }],
    capabilities: [],
    site: null,
    palette: null,
    ...over,
  }) as unknown as BuildSpec;

async function coverage(prompt: string, s: BuildSpec) {
  canonicalizeSpec(s, recipesDir, prompt);
  const about = [
    s.app_name,
    s.summary,
    ...s.entities.map((e) => e.name),
    ...(s.request_words ?? []),
  ];
  const planned = planCriteria(
    s.acceptance_criteria,
    recipesDir,
    s.recipe,
    gateDomains(s, prompt),
    { entities: s.entities, roles: s.roles, about },
  );
  const verdict = await gateRequest({
    prompt,
    spec: s,
    componentsDir,
    decider: skeptic,
    provenByTests: new Set(planned.filter((c) => c.status === "covered").map((c) => c.criterion)),
  });
  const met = planned.filter((c) => c.status === "covered").length;
  return {
    verdict,
    planned,
    ratio: met / planned.length,
    canonical: planned.flatMap((c) => c.canonical ?? []),
  };
}

describe("shop requests map to the storefront's proven functions (ADR-0071)", () => {
  it("a simple shop with sizes, a basket and card payments is covered by code with at least 80 % functional coverage", async () => {
    const prompt = "A small online shop for a hat label with sizes, a basket and card payments";
    const r = await coverage(
      prompt,
      spec({
        recipe: "storefront",
        app_name: "HatHaus",
        summary: "An online shop for hats with size choice and secure card checkout.",
        entities: [
          { name: "Product", fields: [{ name: "name", type: "string", required: true }] },
          { name: "ProductVariant", fields: [{ name: "size", type: "string", required: true }] },
        ],
        acceptance_criteria: [
          "Given a shopper is on a product page, when they select a size and click 'Add to Cart', then the item is added to the shopping cart.",
          "Given a shopper has items in their cart, when they navigate to the cart page, then the total price is calculated correctly based on item quantities.",
          "Given a shopper is in the checkout flow, when they enter valid debit card details and submit, then the payment is processed and a confirmation is shown.",
          "Given a shopper is on a product page, when they try to add a size that is out of stock, then the 'Add to Cart' button is disabled.",
        ],
      }),
    );
    expect(r.verdict.notCovered).toEqual([]);
    expect(r.verdict.status).toBe("covered");
    expect(r.ratio).toBeGreaterThanOrEqual(0.8);
    expect(r.canonical).toEqual(
      expect.arrayContaining([
        "storefront.card-payment",
        "storefront.variant-sold-out",
        "storefront.cart",
      ]),
    );
  });

  it("a full shop's discount, currency, shipping and Stripe Tax rules map to their canonical criteria", async () => {
    const prompt =
      "Web shop with variants with their own SKU, price and stock, discount codes (percent or fixed, minimum order, " +
      "usage limit, expiry), several currencies with fixed prices, shipping by country, taxes by country or automatic " +
      "Stripe Tax, Stripe Checkout, orders and stock and an admin panel";
    const r = await coverage(
      prompt,
      spec({
        recipe: "storefront",
        app_name: "Northwind Goods",
        summary:
          "A shop with variants, discount codes, multi-currency, shipping, taxes and Stripe payments.",
        entities: [{ name: "Product", fields: [{ name: "name", type: "string", required: true }] }],
        acceptance_criteria: [
          "Given a discount code with a percentage value, when a buyer applies it to a qualifying cart, then the total price is reduced by that percentage.",
          "Given a discount code with a minimum order requirement, when the cart total is below that amount, then the code cannot be applied.",
          "Given a discount code with an expiry date, when the current date is past the expiry, then the code is rejected.",
          "Given several currencies are configured, when a buyer selects a specific currency, then the product prices are displayed using the fixed price set for that currency.",
          "Given shipping options are defined by country, when a buyer selects a shipping destination, then only the valid shipping methods for that country are shown.",
          "Given Stripe Tax is enabled, when a buyer enters a shipping address, then the system automatically calculates and applies the correct tax rate.",
          "Given an item in the cart, when the buyer proceeds to checkout, then the item is added to the Stripe Checkout session with the correct price.",
        ],
      }),
    );
    expect(r.verdict.notCovered).toEqual([]);
    expect(r.verdict.status).toBe("covered");
    expect(r.ratio).toBe(1);
    expect(r.canonical).toEqual(
      expect.arrayContaining([
        "storefront.discount-codes",
        "storefront.discount-refused",
        "storefront.currencies",
        "storefront.shipping",
        "storefront.stripe-tax",
        "storefront.checkout",
      ]),
    );
  });
});

describe("card payment when booking (payments.booking-deposit.turbineh, ADR-0071)", () => {
  const booking = (prompt: string, criteria: string[]) =>
    coverage(
      prompt,
      spec({
        recipe: "bookings",
        app_name: "Fade Room",
        summary: "Online bookings for a barber shop with a card deposit.",
        entities: [
          { name: "Appointment", fields: [{ name: "start", type: "datetime", required: true }] },
        ],
        acceptance_criteria: criteria,
      }),
    );

  it("code selects the payment component from the request and its test covers paying by card when booking", async () => {
    const prompt =
      "Booking page for a barber shop (cut 30 min 20 €); clients pay a 5 € deposit by card when they book.";
    expect(gateDomains({ recipe: "bookings", app_name: "Fade Room" }, prompt)).toContain(
      "payments.booking-deposit.turbineh",
    );
    const r = await booking(prompt, [
      "Given a client picks a service and a time, when they complete the checkout with a valid card, then a booking confirmation is created in the database.",
    ]);
    expect(r.verdict.status).toBe("covered");
    expect(r.canonical).toContain("payments.booking-deposit.pay-to-book");
  });

  it("without the component the same requirement stays outside (a booking app without payments is not offered as paying)", async () => {
    const prompt = "Booking page for a barber shop (cut 30 min 20 €). Clients book online.";
    expect(gateDomains({ recipe: "bookings", app_name: "Fade Room" }, prompt)).not.toContain(
      "payments.booking-deposit.turbineh",
    );
    const r = await booking(prompt, [
      "Given a client picks a service and a time, when they complete the checkout with a valid card, then a booking confirmation is created in the database.",
    ]);
    expect(r.verdict.status).toBe("uncovered");
  });

  it("SMS reminders and a native iOS app stay not covered next to the covered payment", async () => {
    const prompt =
      "Appointments site for a nail studio: clients pay by card when they book, get a text reminder the day before, and staff use a native iOS app.";
    const r = await booking(prompt, [
      "Given a client picks a service and a time, when they complete the checkout with a valid card, then a booking confirmation is created in the database.",
      "Given a staff member is logged into the native iOS app, when a client books on the website, then the appointment appears in their mobile calendar in real time.",
    ]);
    // The payment requirement now reads as the component's canonical criterion (ADR-0063) and is covered by its test.
    expect(r.canonical).toContain("payments.booking-deposit.pay-to-book");
    expect(r.verdict.requirements.find((x) => /pays by card/.test(x.requirement))?.covered).toBe(
      true,
    );
    expect(r.verdict.notCovered.map((x) => x.why).join(" ")).toMatch(/native mobile app/);
  });
});

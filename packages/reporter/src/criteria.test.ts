import { describe, expect, it } from "vitest";
import { lexicalEvidence } from "./report.js";

// Evidence and criteria from the staging build of the Frontiers shop prompt (2026-10-12).
const evidence = [
  "End-to-end test: shoppers search the catalogue by product name: only matching products are listed",
  "End-to-end test: a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
  "End-to-end test: pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
  "End-to-end test: the admin updates a product's price and the public catalogue shows it at once",
  "Unit test: totals carts exactly and formats money",
];

describe("deterministic criteria → test mapping", () => {
  it("maps criteria to the passing test whose title states them", () => {
    expect(
      lexicalEvidence(
        "Given an order is marked as 'Paid' via webhook, then the stock level for each purchased product must be decremented by the quantity ordered.",
        evidence,
      ),
    ).toBe(evidence[2]);
    expect(
      lexicalEvidence(
        "Given a successful payment, when the order process completes, then an order confirmation email must be logged to the console if no SMTP provider is configured.",
        evidence,
      ),
    ).toBe(evidence[2]);
    expect(
      lexicalEvidence(
        "Given a user is browsing the catalogue, when they enter a product name in the search bar, then the displayed list must only contain products matching that name.",
        evidence,
      ),
    ).toBe(evidence[0]);
    expect(
      lexicalEvidence(
        "Given an authenticated admin user is in the admin area, when they update a product's price, then the change must be reflected in the public catalogue immediately.",
        evidence,
      ),
    ).toBe(evidence[3]);
  });

  it("leaves weak matches to the decider", () => {
    expect(lexicalEvidence("Shoppers can leave reviews with star ratings", evidence)).toBeNull();
  });
});

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
  // Precision first (ADR-0039 §4): the deterministic pass accepts a test only when it exercises every salient word of
  // the criterion; long Given/When/Then criteria whose extra details the title does not show go to the decider.
  it("leaves criteria with details the test title does not show to the decider", () => {
    expect(
      lexicalEvidence(
        "Given an order is marked as 'Paid' via webhook, then the stock level for each purchased product must be decremented by the quantity ordered.",
        evidence,
      ),
    ).toBeNull();
    expect(
      lexicalEvidence(
        "Given a successful payment, when the order process completes, then an order confirmation email must be logged to the console if no SMTP provider is configured.",
        evidence,
      ),
    ).toBeNull();
  });

  it("ignores Given/When/Then mechanics (browsing, search bar, admin area) but not what is checked (ADR-0043)", () => {
    // Labelled met in the proof fixtures (s-search-name, s-admin-price): the title exercises every checked word.
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

  it("maps a criterion the test title states completely", () => {
    expect(
      lexicalEvidence(
        "Shoppers search the catalogue by product name and see only matching products",
        [
          ...evidence,
          "End-to-end test: shoppers search the catalogue by product name and see only matching products, not the others",
        ],
      ),
    ).toBe(
      "End-to-end test: shoppers search the catalogue by product name and see only matching products, not the others",
    );
  });

  it("never maps the false matches of production build f195341c", () => {
    const generated = [
      "End-to-end test: owner edits a note and sees the change",
      "End-to-end test: owner creates a note and sees it in the list",
      "End-to-end test: owner creates a workspace member and sees it in the list",
    ];
    for (const c of [
      "Given a viewer, when they attempt to edit a note, the system denies the request.",
      "Given an owner, when they invite a teammate via email, the teammate is assigned the specified role (owner, editor, or viewer).",
      "Given a change to any note, when an owner views the audit log, the change is recorded and visible.",
      "Given the notes list, when a user searches by text, the list updates to show only matching notes.",
    ])
      expect(lexicalEvidence(c, generated)).toBeNull();
  });

  it("leaves weak matches to the decider", () => {
    expect(lexicalEvidence("Shoppers can leave reviews with star ratings", evidence)).toBeNull();
  });
});

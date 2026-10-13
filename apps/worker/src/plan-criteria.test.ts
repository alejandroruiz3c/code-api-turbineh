import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCriteria } from "./pipeline.js";

const recipesDir = join(import.meta.dirname, "..", "..", "..", "catalog", "recipes");

describe("plan criteria (known before generation, ADR-0036)", () => {
  it("marks criteria a shipped test will prove as covered and the rest as open", () => {
    const c = planCriteria(
      [
        "Shoppers pay with Stripe Checkout; the signed webhook marks the order as paid",
        "Shoppers search the catalogue by product name",
        "The roaster's blog publishes weekly brewing guides",
      ],
      recipesDir,
      "storefront",
      [],
    );
    expect(c.map((x) => x.status)).toEqual(["covered", "covered", "open"]);
    expect(c[0]?.tests[0]).toMatch(/^tests\/e2e\/shop\.spec\.ts › /);
    expect(c[2]?.tests).toEqual([]);
  });
});

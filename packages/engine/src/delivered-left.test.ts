import { describe, expect, it } from "vitest";
import { flowOutcome, flowResult } from "./result.js";

/**
 * ADR-0064 (validation dry run, 16/10/2026): a generated flow's "what is left" listed "Check it in the app, then add a
 * test" for criteria turbineh.json marked as met with a passing E2E test — the plan's prediction instead of the
 * delivered package. It now comes from the delivered acceptance result and manifest.
 */
describe("what is left after generation comes from the delivered package", () => {
  const row: Parameters<typeof flowOutcome>[0] = {
    id: "f1",
    status: "done",
    options: { mode: "generate" },
    error: null,
    artifact: { zipKey: "k" },
    metrics: {
      plan: {
        capability: { id: "bookings", kind: "use_case" },
        left: [
          {
            part: "A customer books a grooming slot",
            why: "",
            where: "Check it in the app, then add a test",
          },
          {
            part: "The groomer sees the day's calendar",
            why: "",
            where: "Check it in the app, then add a test",
          },
        ],
        config: [{ kind: "env", name: "STRIPE_SECRET_KEY", why: "x", satisfied: false }],
      },
      verify: [{ name: "e2e", ok: true }],
      acceptance: { met: 1, covered: 0, open: ["The groomer sees the day's calendar"] },
      manifest: {
        schema: "turbineh.delivery/v1",
        recipe: "bookings",
        approved: true,
        entries: [],
        criteria: [],
        env: {
          required: [{ name: "DATABASE_URL", about: "" }],
          optional: [{ name: "EMAIL_FROM", about: "" }],
        },
        notSelected: [],
        brokenPromises: [],
      },
    },
  };

  it("lists only the criteria no passing test proves, and the delivered app's settings", () => {
    const left = flowOutcome(row).left.join("\n");
    expect(left).not.toContain("A customer books a grooming slot");
    expect(left).toContain("The groomer sees the day's calendar — no passing test proves it yet");
    expect(left).toContain("Set DATABASE_URL");
    expect(left).not.toContain("STRIPE_SECRET_KEY");
    const needs = flowResult(row, { zipUrl: null, manifestUrl: null }).needs;
    expect(needs.map((n) => [n.name, n.required])).toEqual([
      ["DATABASE_URL", true],
      ["EMAIL_FROM", false],
    ]);
  });
});

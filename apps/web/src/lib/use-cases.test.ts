import { summarizeUseCase, USE_CASES as CATALOG } from "@turbineh/engine";
import { describe, expect, it } from "vitest";
import { stateOfBuild } from "./states";
import { matchUseCases, USE_CASES } from "./use-cases";

describe("Discover by need", () => {
  it("finds the AI flow for agent needs and the store for shop needs", () => {
    expect(matchUseCases("support agent over our help centre")[0]?.id).toBe("ai-agents");
    expect(matchUseCases("online store with discount codes")[0]?.id).toBe("storefront");
    expect(matchUseCases("booking flow for a clinic")[0]?.id).toBe("bookings");
    // An AI agent that books is an AI flow; bookings comes next as its domain.
    const ai = matchUseCases("An AI booking agent for a physiotherapy clinic").map((u) => u.id);
    expect(ai.slice(0, 2)).toEqual(["ai-agents", "bookings"]);
  });

  it("returns every use case for an empty need and none for an unrelated one", () => {
    expect(matchUseCases("")).toHaveLength(USE_CASES.length);
    expect(matchUseCases("quantum chromodynamics")).toHaveLength(0);
  });

  it("names, summaries, functions and examples come from the catalogue (ADR-0076)", () => {
    expect(USE_CASES.map((u) => u.id).sort()).toEqual(CATALOG.map((u) => u.id).sort());
    for (const u of USE_CASES) {
      const c = CATALOG.find((x) => x.id === u.id)!;
      expect(u.name).toBe(c.name);
      expect(u.summary).toBe(c.tagline);
      expect(u.functions).toEqual(c.functions);
      // The guarded example (apps/worker/src/example-prompts.test.ts), never an unchecked one.
      expect(u.example).toBe(summarizeUseCase(c).example);
    }
  });

  it("never names a third-party decider in product copy", () => {
    const copy = JSON.stringify(USE_CASES).toLowerCase();
    for (const banned of ["jev", "typesafe", "quyet"]) expect(copy).not.toContain(banned);
  });
});

describe("precise states (PLAN §16.2)", () => {
  it("maps builds to states without ever saying ready", () => {
    expect(stateOfBuild("done", false)).toBe("verified");
    expect(stateOfBuild("done", true)).toBe("deployed");
    expect(stateOfBuild("failed", false)).toBe("failed");
    expect(stateOfBuild("failed", false, true)).toBe("generated");
    expect(stateOfBuild("queued", false)).toBe("planned");
    expect(stateOfBuild("verifying", false)).toBe("generating");
  });
});

import { describe, expect, it } from "vitest";
import { decisionIO } from "./transport.js";
import { openDecider, openEngine, openIntent, openSelection } from "./open.js";
import { privateEnginesRequired } from "./required.js";

const RECIPES = {
  bookings: "Booking or appointment app: availability, calendar slots and notifications",
  storefront: "Online shop: product catalog with prices, cart and online payment",
  out_of_scope: "Anything else",
};

describe("open minimal fallback of the decision engine (ADR-0058)", () => {
  it("is the open edition: a heuristic decider for the worker, none for planning, no hedging", async () => {
    expect(openEngine.edition).toBe("open");
    expect(openEngine.fromEnv({}, decisionIO)).toBe(openDecider);
    expect(openEngine.forPlanning({ TYPESAFE_API_KEY: "x" }, decisionIO)).toBeNull();
    expect(
      openEngine.hedging.delayMs(
        { afterMs: 100, afterMsByModel: "", target: "same", chatModels: [] },
        "m",
      ),
    ).toBe(0);
    let attempts = 0;
    const r = await openEngine.hedging.run({
      model: "m",
      config: { afterMs: 1, afterMsByModel: "", target: "next", chatModels: ["m", "n"] },
      timeoutMs: 1000,
      attempt: async () => (attempts++, { ok: true as const }),
      reserve: async () => true,
    });
    expect(r).toEqual({ ok: true, hedge: "none" });
    expect(attempts).toBe(1);
  });

  it("classifies the request by the words it shares with the public recipe descriptions", () => {
    const v = openIntent({
      prompt: "Patients book appointments in free calendar slots",
      recipes: RECIPES,
    });
    expect(v.decisions.recipe.choice).toBe("bookings");
    expect(v.capabilities).toEqual([]);
    expect(v.abuse).toEqual([]);
    expect(openIntent({ prompt: "zzz", recipes: RECIPES }).decisions.recipe.choice).toBe(
      "out_of_scope",
    );
    expect(openIntent({ prompt: "A phishing page", recipes: RECIPES }).abuse).toEqual([
      ["phishing", 1],
    ]);
  });

  it("selects approved components that declare the capability, in catalogue order", () => {
    const card = (id: string, status: string, provides: string[]) => ({
      id,
      status,
      provides,
      card: id,
    });
    const r = openSelection({
      app: { recipe: "bookings", summary: "", acceptance_criteria: [] },
      candidates: {
        "data.dates": [
          card("dates.candidate", "candidate", ["data.dates"]),
          card("dates.a", "approved", ["data.dates"]),
          card("dates.b", "approved", ["data.dates"]),
        ],
        "ui.map": [card("other", "approved", ["ui.charts"])],
        "ui.none": [],
      },
    });
    expect(r.decisions.map((d) => [d.capability, d.ranked.map((c) => c.id), d.trigger])).toEqual([
      ["data.dates", ["dates.a", "dates.b"], null],
      ["ui.map", [], "T2"],
      ["ui.none", [], "T1"],
    ]);
    expect(r.decider).toMatchObject({ backend: "heuristic", requests: 0 });
  });

  it("leaves every other decision to the callers' code", async () => {
    expect(
      await openDecider.scopeOutside({ useCase: null, catalog: [], requirements: [] }),
    ).toBeNull();
    expect(await openDecider.chooseApp({ apps: [] })).toBeNull();
    expect(await openDecider.entityKinds({ prompt: "", entities: {}, unsure: [] })).toBeNull();
    expect(await openDecider.triageFindings([])).toBeNull();
    expect(await openDecider.fixableFindings([])).toBeNull();
    expect(await openDecider.matchCriteria({ summary: "", notVerified: "", items: [] })).toBeNull();
    expect(
      await openDecider.businessRules({
        summary: "",
        recipe: "",
        criteria: ["x"],
        entities: {},
        links: {},
      }),
    ).toEqual([]);
  });

  it("production requires the private engines unless an open run is deliberate", () => {
    expect(privateEnginesRequired({})).toBe(false);
    expect(privateEnginesRequired({ VERCEL_ENV: "production" })).toBe(true);
    expect(privateEnginesRequired({ TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION: "1" })).toBe(true);
    expect(
      privateEnginesRequired({
        TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION: "1",
        TURBINEH_ALLOW_OPEN_ORCHESTRATION: "1",
      }),
    ).toBe(false);
  });
});

import { openDecider, type Decider } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { labelledSet, runOfferSet } from "./offer-bench.js";

/**
 * ADR-0062 (owner rule: never offer for the sake of offering): the components-only offer on the labelled set
 * bench/offers/labelled.json, against the real catalogue. The real engine's run is `src/offer-bench.ts --engine`.
 */
const judge = (yes: boolean): Decider => ({
  ...openDecider,
  componentsServe: async (input) => ({
    serves: Object.fromEntries(
      input.requirements.map((r) => [r.index, yes ? r.candidates.map((c) => c.id) : []]),
    ),
    meta: { model: yes ? "approve-all" : "reject-all", latencyMs: 0 },
  }),
});

// The whole set runs the gate and the offer against the real catalogue: slower than a unit test on CI runners.
describe("offer precision on the labelled set (ADR-0062)", { timeout: 60_000 }, () => {
  it("has at least 15 mixed requests: some with a real function to offer, some with nothing", () => {
    const set = labelledSet();
    expect(set.length).toBeGreaterThanOrEqual(15);
    expect(set.filter((r) => r.acceptable.length === 0).length).toBeGreaterThanOrEqual(7);
    expect(set.filter((r) => r.acceptable.length > 0).length).toBeGreaterThanOrEqual(7);
  });

  it("code alone (no judgement) offers nothing wrong, and nothing where any part is blocked", async () => {
    const r = await runOfferSet(openDecider);
    expect(r.cases.every((c) => c.gate === "uncovered")).toBe(true);
    expect(r.cases.flatMap((c) => c.wrong)).toEqual([]);
    expect(r.precision === null || r.precision === 1).toBe(true);
    const nothing = new Set(
      labelledSet()
        .filter((x) => x.acceptable.length === 0)
        .map((x) => x.id),
    );
    for (const c of r.cases) if (nothing.has(c.id)) expect(c.offered, c.id).toEqual([]);
    // The owner's example: publishing to social networks is the core and is blocked — no offer without a judge.
    expect(r.cases.find((c) => c.id === "social-publisher")?.offered).toEqual([]);
  });

  it("the deterministic checks alone, even with a judge that approves everything: ≥ 0.9 precision", async () => {
    const r = await runOfferSet(judge(true));
    expect(r.precision).toBeGreaterThanOrEqual(0.9);
    // Generic plumbing is never offered (sign-in the person didn't ask for, schedulers for social publishing).
    const social = r.cases.find((c) => c.id === "social-publisher");
    expect(social?.offered).toEqual(["ai.orchestrator.turbineh"]);
    for (const id of [
      "slack-standup",
      "ios-gym",
      "trading-bot",
      "whatsapp-reminders",
      "google-calendar-sync",
    ])
      expect(r.cases.find((c) => c.id === id)?.offered, id).toEqual([]);
    // The one pair code cannot rule out (a schedule for Bluetooth lights) is exactly what the judgement is for.
    expect(r.cases.flatMap((c) => c.wrong.map((w) => `${c.id}:${w}`))).toEqual([
      "smart-home-lights:jobs.scheduled.turbineh",
    ]);
  });

  it("a judge that confirms nothing → nothing is offered", async () => {
    const r = await runOfferSet(judge(false));
    expect(r.offered).toBe(0);
  });
});

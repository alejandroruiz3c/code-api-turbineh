import { openDecider, type Decider, type RulesInput } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { decideRules, rulesWithoutCode, type RuleCandidate } from "./business-rules.js";

describe("T3 business rules through the decision engine (ADR-0058)", () => {
  const input: RulesInput = {
    summary: "Room bookings",
    recipe: "Booking app",
    criteria: ["A room holds at most 10 guests"],
    entities: { Booking: ["room (reference)", "guests (number)"] },
    links: { Booking: ["Room"] },
  };

  it("asks the engine only when there are criteria and generated entities", async () => {
    const asked: RulesInput[] = [];
    const d: Decider = {
      ...openDecider,
      businessRules: async (i) => (asked.push(i), []),
    };
    expect(await decideRules({ ...input, criteria: [] }, d)).toEqual([]);
    expect(await decideRules({ ...input, entities: {} }, d)).toEqual([]);
    expect(asked).toHaveLength(0);
    await decideRules(input, d);
    expect(asked).toEqual([input]);
  });

  it("the open fallback writes no T3 code", async () => {
    expect(await decideRules(input, openDecider)).toEqual([]);
  });
});

describe("rules of the request never vanish (ADR-0054)", () => {
  const c = (criterion: string, reason: string, selected = false): RuleCandidate => ({
    criterion,
    isRule: 0.9,
    covered: 0,
    entity: "Request",
    entityConfidence: 0.9,
    complexity: 1,
    operations: ["create", "update"],
    related: [],
    selected,
    reason,
  });

  it("lists every rule without code as a limitation (not chosen) or blocked (chosen, not written)", () => {
    const out = rulesWithoutCode(
      [
        c("Amounts over 500 need a second approval", "needs users, roles or an external service"),
        c("No two requests share a title", "selected", true),
        c("Titles are at most 80 characters", "selected", true),
        c("A request has a title", "covered by the generated form"),
        c("Owners see a dashboard", "not a business rule"),
      ],
      ["Titles are at most 80 characters"],
    );
    expect(out).toEqual([
      {
        criterion: "Amounts over 500 need a second approval",
        entity: "Request",
        reason: "needs users, roles or an external service",
        blocked: false,
      },
      {
        criterion: "No two requests share a title",
        entity: "Request",
        reason: "the backup code model could not write it safely",
        blocked: true,
      },
    ]);
  });
});

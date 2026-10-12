import type { Answer } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { mentionsOtherEntity, ruleQuestions, selectRules, T3_POLICY } from "./business-rules.js";

const noul = (p: number): Answer => ({ type: "noul", noul: p }) as Answer;
const pick = (c: string, confidence = 0.9): Answer =>
  ({ type: "choice", choice: c, confidence, probabilities: { [c]: 0.9 } }) as unknown as Answer;
const score = (s: number): Answer =>
  ({ type: "score", score: s, confidence: 0.8, probabilities: {} }) as unknown as Answer;

function answers(
  rows: {
    rule: number;
    covered: number;
    entity: string;
    conf?: number;
    complexity: number;
    other?: number;
  }[],
) {
  const out: Record<string, Answer> = {};
  rows.forEach((r, i) => {
    out[`rule:${i}`] = noul(r.rule);
    out[`covered:${i}`] = noul(r.covered);
    out[`other:${i}`] = noul(r.other ?? 0.1);
    out[`entity:${i}`] = pick(r.entity, r.conf);
    out[`complexity:${i}`] = score(r.complexity);
  });
  return out;
}

describe("T3 business-rule policy", () => {
  it("asks five atomic questions per criterion in one batch", () => {
    const q = ruleQuestions(["a rule", "another"], ["Membership"]);
    expect(Object.keys(q)).toHaveLength(10);
    expect(q["complexity:1"]?.type).toBe("score");
  });

  it("selects rules on generated entities within the complexity band and explains every other decision", () => {
    const criteria = [
      "A member cannot have two active memberships",
      "Staff can list memberships",
      "Bookings never overlap",
      "Price must be greater than zero",
      "Invoices are paid through Stripe",
      "Plan names are unique",
    ];
    const r = selectRules(
      criteria,
      answers([
        { rule: 0.95, covered: 0.1, entity: "Membership", complexity: 2 },
        { rule: 0.1, covered: 0.1, entity: "Membership", complexity: 0 },
        { rule: 0.9, covered: 0.9, entity: "Membership", complexity: 2 },
        { rule: 0.9, covered: 0.1, entity: "Plan", complexity: 1 },
        { rule: 0.8, covered: 0.1, entity: "Invoice", complexity: 3 },
        { rule: 0.9, covered: 0.1, entity: "none_of_the_above", complexity: 2 },
      ]),
    );
    expect(r.map((c) => c.reason)).toEqual([
      "selected",
      "not a business rule",
      "already part of the recipe",
      "selected",
      "needs more than one kind of record or an external service",
      "no generated entity it applies to",
    ]);
  });

  it("caps the rules per build and ignores low-confidence entity choices", () => {
    const rows = Array.from({ length: T3_POLICY.maxRules + 2 }, () => ({
      rule: 0.9,
      covered: 0,
      entity: "Loan",
      complexity: 2,
    }));
    rows[0] = { ...rows[0]!, conf: 0.2 } as (typeof rows)[number];
    const r = selectRules(
      rows.map((_, i) => `rule ${i}`),
      answers(rows),
    );
    expect(r[0]?.reason).toBe("no generated entity it applies to");
    expect(r.filter((c) => c.selected)).toHaveLength(T3_POLICY.maxRules);
    expect(r.at(-1)?.reason).toBe("over the per-build limit");
  });

  it("leaves rules that need other kinds of records to the recipe (decider or entity named in the text)", () => {
    const criteria = [
      "A course cannot be created if the assigned teacher does not exist in the workspace",
      "A course cannot be created for a student who is not enrolled",
      "Course titles are unique",
    ];
    const r = selectRules(
      criteria,
      answers([
        { rule: 0.9, covered: 0.1, entity: "Course", complexity: 2, other: 0.8 },
        { rule: 0.9, covered: 0.1, entity: "Course", complexity: 2, other: 0.2 },
        { rule: 0.9, covered: 0.1, entity: "Course", complexity: 2 },
      ]),
      ["Course", "Student"],
    );
    expect(r.map((c) => c.selected)).toEqual([false, false, true]);
    expect(r[0]?.reason).toBe("needs more than one kind of record or an external service");
    expect(mentionsOtherEntity("Two students per room", "Room", ["Room", "Student"])).toBe(true);
    expect(mentionsOtherEntity("Room names are unique", "Room", ["Room", "Student"])).toBe(false);
  });
});

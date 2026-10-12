import type { Answer } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { mentionedEntities, ruleQuestions, selectRules, T3_POLICY } from "./business-rules.js";

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
    related?: string;
    relatedConf?: number;
    when?: "create" | "update" | "both";
    whenConf?: number;
  }[],
) {
  const out: Record<string, Answer> = {};
  rows.forEach((r, i) => {
    out[`rule:${i}`] = noul(r.rule);
    out[`covered:${i}`] = noul(r.covered);
    out[`other:${i}`] = noul(r.other ?? 0.1);
    out[`entity:${i}`] = pick(r.entity, r.conf);
    out[`related:${i}`] = pick(r.related ?? "none_of_the_above", r.relatedConf);
    out[`when:${i}`] = pick(r.when ?? "both", r.whenConf);
    out[`complexity:${i}`] = score(r.complexity);
  });
  return out;
}

describe("T3 business-rule policy", () => {
  it("asks seven atomic questions per criterion in one batch", () => {
    const q = ruleQuestions(["a rule", "another"], ["Membership", "Member"]);
    expect(Object.keys(q)).toHaveLength(14);
    expect(q["complexity:1"]?.type).toBe("score");
    expect(q["when:0"]?.type).toBe("choice");
    expect(q["related:0"]?.type).toBe("choice");
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
      "needs users, roles or an external service",
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

  it("decides create, update or both (both when unsure)", () => {
    const r = selectRules(
      ["only on create", "only on edit", "always", "unsure"],
      answers([
        { rule: 0.9, covered: 0, entity: "Loan", complexity: 1, when: "create" },
        { rule: 0.9, covered: 0, entity: "Loan", complexity: 1, when: "update" },
        { rule: 0.9, covered: 0, entity: "Loan", complexity: 1, when: "both" },
        { rule: 0.9, covered: 0, entity: "Loan", complexity: 1, when: "update", whenConf: 0.3 },
      ]),
    );
    expect(r.map((c) => c.operations)).toEqual([
      ["create"],
      ["update"],
      ["create", "update"],
      ["create", "update"],
    ]);
  });

  it("routes cross-entity rules to linked entities and leaves the rest to the recipe", () => {
    const criteria = [
      "A course can only be assigned to a teacher who exists in the teachers list",
      "A course cannot be created for a student who is not enrolled",
      "Only users with the teacher role can be assigned",
      "Course titles are unique",
    ];
    const entities = ["Course", "Teacher", "Student"];
    const links = { Course: ["Teacher"] };
    const r = selectRules(
      criteria,
      answers([
        {
          rule: 0.9,
          covered: 0.1,
          entity: "Course",
          complexity: 2,
          other: 0.8,
          related: "Teacher",
        },
        {
          rule: 0.9,
          covered: 0.1,
          entity: "Course",
          complexity: 2,
          other: 0.8,
          related: "Student",
        },
        { rule: 0.9, covered: 0.1, entity: "Course", complexity: 2, other: 0.9 },
        { rule: 0.9, covered: 0.1, entity: "Course", complexity: 2 },
      ]),
      entities,
      links,
    );
    expect(r.map((c) => c.selected)).toEqual([true, false, false, true]);
    expect(r[0]?.related).toEqual(["Teacher"]);
    expect(r[1]?.reason).toBe(
      "needs records it is not linked to (users, roles, or an entity without a reference field)",
    );
    expect(r[2]?.reason).toBe(r[1]?.reason);
    expect(r[3]?.related).toEqual([]);
  });

  it("uses the entity named in the rule text when the decider is unsure, never more than two", () => {
    const r = selectRules(
      ["A booking cannot exceed the room capacity and the guest must be a client of the venue"],
      answers([
        {
          rule: 0.9,
          covered: 0.1,
          entity: "Booking",
          complexity: 2,
          related: "Room",
          relatedConf: 0.2,
        },
      ]),
      ["Booking", "Room", "Client", "Venue"],
      { Booking: ["Room", "Client", "Venue"] },
    );
    expect(r[0]?.selected).toBe(true);
    expect(r[0]?.related).toEqual(["Room", "Client"]);
    expect(mentionedEntities("Two students per room", "Room", ["Room", "Student"])).toEqual([
      "Student",
    ]);
    expect(mentionedEntities("Room names are unique", "Room", ["Room", "Student"])).toEqual([]);
  });
});

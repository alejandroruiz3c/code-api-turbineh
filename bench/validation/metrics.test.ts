import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvedScopeCoverage,
  contradictions,
  estimateErrors,
  functionalCoverage,
  gapsWarned,
  observedOutcome,
  outcomeOk,
  precisionAt5,
  type Statement,
  type StatementRun,
  scoreRequirements,
  verifiedClaims,
  warnedBeforeGenerating,
} from "./metrics.ts";

const base = (over: Partial<StatementRun>): StatementRun => ({
  id: "X01",
  band: "A",
  env: "staging",
  api: "https://staging.example",
  runId: "t",
  startedAt: "",
  finishedAt: "",
  phase: "done",
  error: null,
  flowId: "f",
  plan: { httpStatus: 200, problem: null, body: {}, ms: 1 },
  approved: null,
  generate: null,
  final: null,
  build: null,
  manifest: null,
  guide: null,
  timings: { planMs: 1, generateMs: 100_000, wallMs: 120_000 },
  ...over,
});

const stA: Statement = {
  id: "X01",
  band: "A",
  recipe: "bookings",
  expected: "build",
  prompt: "p",
  requirements: [
    { id: "R1", text: "book", match: ["book"] },
    { id: "R2", text: "confirmation email", match: ["confirm", "email"] },
    { id: "R3", text: "days off", match: ["days? off"] },
  ],
  gaps: [],
};

describe("validation scoring", () => {
  it("scores a built flow: met only with a passing criterion, coverage over canonical requirements", () => {
    const r = base({
      final: {
        plan: { components: [{ id: "a" }], estimate: { newLinesToMaintain: 100, seconds: 50 } },
        result: {
          state: "verified",
          metrics: { newLines: 80, seconds: 100 },
          outcome: {
            kind: "app_verified",
            checks: { passed: 11, total: 11 },
            requirements: { met: 1, total: 2 },
            left: ["x"],
          },
        },
      },
      guide: {
        status: "verified",
        checks: "11/11",
        left: [{ what: "x" }],
        criteria: [
          { text: "Customers can book a slot", status: "met" },
          { text: "A confirmation email is sent", status: "open" },
        ],
      },
      manifest: {
        state: "verified",
        components: [{ id: "a" }],
        checks: Array.from({ length: 11 }, () => ({ name: "c", ok: true })),
      },
    });
    const scores = scoreRequirements(stA, r);
    // conservative mapping: "book" matches only the met criterion here
    expect(scores.map((s) => s.status)).toEqual(["met", "open", "missing"]);
    expect(functionalCoverage(scores)).toBeCloseTo(1 / 3);
    expect(observedOutcome(r)).toBe("built");
    expect(outcomeOk(stA, r)).toBe(true);
    expect(verifiedClaims(r).length).toBeGreaterThan(0);
    expect(contradictions(r)).toEqual([]);
    const e = estimateErrors(r);
    expect(e.lines?.error).toBeCloseTo(0.25);
    expect(e.time?.error).toBeCloseTo(0.5);
  });

  it("a requirement is met only when every criterion it maps to is met; removed ones leave the approved scope", () => {
    const st: Statement = {
      ...stA,
      requirements: [
        ...(stA.requirements ?? []),
        { id: "R4", text: "wa", match: ["whatsapp"], new: true },
      ],
    };
    const r = base({
      guide: {
        criteria: [
          { text: "book a slot", status: "met" },
          { text: "book with any staff", status: "open" },
          { text: "confirmation email", status: "met" },
          { text: "days off", status: "met" },
        ],
      },
      plan: {
        httpStatus: 200,
        problem: null,
        body: { scope: { status: "partial", removed: [{ requirement: "WhatsApp reminder" }] } },
        ms: 1,
      },
    });
    const s = scoreRequirements(st, r);
    expect(s.map((x) => x.status)).toEqual(["open", "met", "met", "removed"]);
    expect(functionalCoverage(s)).toBeCloseTo(0.5);
    expect(approvedScopeCoverage(s)).toBeCloseTo(2 / 3);
  });

  it("review.json overrides the automatic mapping", () => {
    const r = base({ guide: { criteria: [{ text: "book", status: "open" }] } });
    const s = scoreRequirements(stA, r, { requirements: { X01: { R1: "met" } } });
    expect(s[0]).toMatchObject({ auto: "open", status: "met", reviewed: true });
  });

  it("finds contradictions between surfaces", () => {
    const r = base({
      final: {
        plan: {
          components: [{ id: "a" }, { id: "b" }],
          scope: { removed: [{ requirement: "Send WhatsApp reminders" }] },
        },
        result: {
          state: "verified",
          outcome: {
            checks: { passed: 11, total: 11 },
            requirements: { met: 2, total: 5 },
            left: ["Send WhatsApp reminders"],
          },
        },
      },
      build: { state: "generated" },
      guide: {
        status: "verified",
        checks: "10/11",
        left: [],
        criteria: [
          { text: "x", status: "met" },
          { text: "y", status: "open" },
        ],
      },
      manifest: { components: [{ id: "a" }] },
    });
    const c = contradictions(r).join("\n");
    expect(c).toMatch(/state: \/v1\/plans says "verified", \/v1\/builds says "generated"/);
    expect(c).toMatch(/checks: outcome 11\/11, turbineh.json 10\/11/);
    expect(c).toMatch(/requirements: outcome 2\/5 met, turbineh.json 1\/2 met/);
    expect(c).toMatch(/turbineh.json left is empty/);
    expect(c).toMatch(/removed requirement "send whatsapp reminders"/);
    expect(c).toMatch(/in the plan, not in manifest.json: b/);
    const r2 = base({
      final: {
        plan: {},
        result: {
          state: "verified",
          outcome: { left: ["Customers book a slot — Check it in the app, then add a test"] },
        },
      },
      guide: {
        status: "verified",
        left: [{ what: "x" }],
        criteria: [{ text: "Customers book a slot", status: "met" }],
      },
    });
    expect(contradictions(r2).join("\n")).toMatch(
      /outcome.left lists a criterion turbineh.json marks met/,
    );
  });

  it("band B: partial with the new capability removed explicitly is the expected outcome", () => {
    const st: Statement = {
      ...stA,
      band: "B",
      expected: "partial_or_offer",
      gaps: [{ text: "WhatsApp", match: ["whats ?app"], knownToGate: true }],
    };
    const r = base({
      plan: {
        httpStatus: 200,
        problem: null,
        body: {
          scope: {
            status: "partial",
            removed: [{ requirement: "WhatsApp reminder", why: "no component" }],
          },
        },
        ms: 1,
      },
    });
    expect(observedOutcome(r)).toBe("partial");
    expect(gapsWarned(st, r)).toEqual([{ gap: "WhatsApp", warned: true }]);
    expect(outcomeOk(st, r)).toBe(true);
  });

  it("band C: a refusal or a components-only offer is warned before generating", () => {
    const st: Statement = {
      ...stA,
      band: "C",
      expected: "refuse_or_offer",
      requirements: [],
      gaps: [{ text: "social", match: ["linkedin"], knownToGate: true }],
    };
    const refused = base({
      flowId: null,
      plan: {
        httpStatus: 422,
        problem: { code: "use_case_not_covered", notCovered: ["Publish to LinkedIn"] },
        body: null,
        ms: 1,
      },
    });
    expect(observedOutcome(refused)).toBe("refused");
    expect(warnedBeforeGenerating(refused)).toBe(true);
    expect(outcomeOk(st, refused)).toBe(true);
    const offer = base({
      flowId: null,
      plan: {
        httpStatus: 422,
        problem: {
          code: "use_case_not_covered",
          explanation: {
            notCovered: [],
            offer: { kind: "components_only", outOfScope: [{ requirement: "LinkedIn" }] },
          },
        },
        body: null,
        ms: 1,
      },
    });
    expect(observedOutcome(offer)).toBe("offer");
    const built = base({
      plan: { httpStatus: 200, problem: null, body: { scope: { status: "covered" } }, ms: 1 },
    });
    expect(warnedBeforeGenerating(built)).toBe(false);
    expect(outcomeOk(st, built)).toBe(false);
  });

  it("precision@5 counts relevant results among those shown", () => {
    expect(precisionAt5(["a", "b", "x", "y", "z", "c"], ["a", "b", "c"])).toBeCloseTo(0.4);
    expect(precisionAt5(["a"], ["a"])).toBe(1);
    expect(precisionAt5([], ["a"])).toBe(0);
  });

  it("the statement set has 10 per band, unique ids and valid patterns", () => {
    const { statements } = JSON.parse(
      readFileSync(join(import.meta.dirname, "statements.json"), "utf8"),
    ) as { statements: Statement[] };
    for (const b of ["A", "B", "C"])
      expect(statements.filter((s) => s.band === b)).toHaveLength(10);
    expect(new Set(statements.map((s) => s.id)).size).toBe(30);
    for (const s of statements) {
      if (s.band !== "C") expect(s.requirements?.length).toBeGreaterThan(0);
      if (s.band !== "A") expect(s.gaps.length).toBeGreaterThan(0);
      if (s.band === "B") expect(s.requirements?.some((r) => r.new)).toBe(true);
      for (const p of [
        ...(s.requirements ?? []).flatMap((r) => r.match),
        ...s.gaps.flatMap((g) => g.match),
      ])
        expect(() => new RegExp(p, "i")).not.toThrow();
    }
  });
});

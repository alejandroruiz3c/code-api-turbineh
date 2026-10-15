import type { Decider } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  backupCodeMarkdown,
  businessRulesMarkdown,
  improvementText,
  reportMarkdown,
  type ReportFacts,
} from "./report.js";

const facts: ReportFacts = {
  appName: "Course Hub",
  summary: "Course management for a small academy.",
  recipe: "saas-crud",
  entities: ["courses"],
  acceptanceCriteria: ["Courses are listed with their teacher", "Admins can export invoices"],
  evidence: ["End-to-end test: owner creates a course"],
  checks: [{ name: "e2e", ok: true }],
  components: [],
  gaps: ["payments.invoices"],
  gapLabels: { "payments.invoices": "invoices" },
  alerts: [],
  remediation: [],
  reusedShare: null,
};

// Writer endpoint that refuses connections: every text section must fall back to deterministic templates.
const offline = { baseURL: "http://127.0.0.1:9/v1", apiKey: "test", model: "writer-test" };

const decider = (answers: Record<string, { choice: string; confidence: number }>) =>
  ({
    ask: async () => ({
      answers: Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, { type: "choice", ...v }]),
      ),
    }),
  }) as unknown as Decider;

describe("buildReport", () => {
  it("marks a criterion verified only with a high-confidence decider match", async () => {
    const high = await buildReport(
      facts,
      decider({ c0: { choice: "End-to-end test: owner creates a course", confidence: 0.95 } }),
      offline,
    );
    expect(high.criteria.map((c) => c.verified)).toEqual([true, false]);
    expect(high.criteria[1]?.evidence).toBe("Not verified automatically");
    const unsure = await buildReport(
      facts,
      decider({ c0: { choice: "End-to-end test: owner creates a course", confidence: 0.6 } }),
      offline,
    );
    expect(unsure.criteria.map((c) => c.verified)).toEqual([false, false]);
  });

  it("never offers the decider a test that ignores the criterion's actor or refusal", async () => {
    let asked: Record<string, unknown> = {};
    const spy = {
      ask: async (_s: unknown, q: Record<string, unknown>) => {
        asked = q;
        return { answers: {} };
      },
    } as unknown as Decider;
    const r = await buildReport(
      {
        ...facts,
        acceptanceCriteria: ["A viewer cannot create courses", "Members can create courses"],
      },
      spy,
      offline,
    );
    expect(Object.keys(asked)).toEqual([]);
    expect(r.criteria.map((c) => c.verified)).toEqual([false, false]);
  });

  it("falls back to plain-language templates when the writer is unavailable", async () => {
    const r = await buildReport(facts, decider({}), offline);
    expect(r.writer.fallback).toBe(true);
    expect(r.security.status).toBe("clear");
    expect(r.nextSteps.join(" ")).toContain("invoices");
    expect(r.nextSteps.join(" ")).not.toContain("payments.invoices");
    expect(reportMarkdown(r, "{}")).toContain(`# ${r.headline}`);
  });
});

describe("improvementText", () => {
  const base = {
    total: 3,
    fixable: 2,
    fixableProduction: 0,
    minutes: { min: 2, max: 5 },
    usesOneBuild: true as const,
  };
  it("states cost, expected gain and the once-only rule", () => {
    const t = improvementText({ improvement: base, finalVersion: false });
    expect(t).toContain("2 of 3");
    expect(t).toContain("2–5 min");
    expect(t).toContain("only once");
  });
  it("offers nothing on the final version or when nothing is fixable", () => {
    expect(improvementText({ improvement: base, finalVersion: true })).toContain("final version");
    expect(
      improvementText({ improvement: { ...base, fixable: 0 }, finalVersion: false }),
    ).toContain("no improvement is offered");
  });
});

describe("business rules section (T3)", () => {
  it("lists delivered rules with when they run, what they read and their tests; dropped rules as not implemented", () => {
    const md = businessRulesMarkdown({
      businessRules: [
        {
          entity: "Membership",
          rules: ["A member cannot have two active memberships"],
          specs: [
            {
              rule: "A member cannot have two active memberships",
              operations: ["create", "update"],
              related: ["Member"],
            },
          ],
          file: "src/entities/memberships/rules.ts",
          test: "tests/unit/rules/memberships.test.ts",
          implemented: true,
        },
        {
          entity: "Loan",
          rules: ["At most 2 open loans per borrower"],
          specs: [
            { rule: "At most 2 open loans per borrower", operations: ["create"], related: [] },
          ],
          file: "src/entities/loans/rules.ts",
          test: "tests/unit/rules/loans.test.ts",
          implemented: false,
        },
      ],
    });
    expect(md).toContain(
      "✅ **Membership**: A member cannot have two active memberships (on create and edit, reads Member)",
    );
    expect(md).toContain("tests/unit/rules/memberships.test.ts");
    expect(md).toContain(
      "⬜ **Loan**: At most 2 open loans per borrower (on create) — not implemented",
    );
    expect(businessRulesMarkdown({ businessRules: [] })).toBe("");
  });
});

describe("Backup Coder section (ADR-0055)", () => {
  it("labels every Backup Coder file as not catalogue-verified", () => {
    const md = backupCodeMarkdown({
      backupCode: [{ capability: "data.money", label: "money", file: "src/backup/data-money.ts" }],
    });
    expect(md).toContain("not catalogue-verified");
    expect(md).toContain("`src/backup/data-money.ts`");
    expect(backupCodeMarkdown({})).toBe("");
  });
});

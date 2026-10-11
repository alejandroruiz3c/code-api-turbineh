import type { Decider } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { buildReport, reportMarkdown, type ReportFacts } from "./report.js";

const facts: ReportFacts = {
  appName: "Course Hub",
  summary: "Course management for a small academy.",
  recipe: "saas-crud",
  entities: ["courses"],
  acceptanceCriteria: ["Members can create courses", "Admins can export invoices"],
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
  it("marks a criterion verified only with matching evidence and enough confidence", async () => {
    const r = await buildReport(
      facts,
      decider({
        c0: { choice: "End-to-end test: owner creates a course", confidence: 0.9 },
        c1: { choice: "End-to-end test: owner creates a course", confidence: 0.3 },
      }),
      offline,
    );
    expect(r.criteria.map((c) => c.verified)).toEqual([true, false]);
    expect(r.criteria[1]?.evidence).toBe("Not verified automatically");
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

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provenOnlyByTests } from "./finalize.js";

describe("criteria are proven only by shipped tests (ADR-0034)", () => {
  it("prefers the deterministic acceptance proof and never counts non-test evidence as met", () => {
    const dir = mkdtempSync(join(tmpdir(), "proof-"));
    mkdirSync(join(dir, ".turbineh"));
    writeFileSync(
      join(dir, ".turbineh/acceptance.json"),
      JSON.stringify([
        {
          criterion: "A",
          status: "covered",
          tests: ["tests/e2e/shop.spec.ts › stock reaches the catalogue"],
        },
        { criterion: "B", status: "open", tests: [] },
        { criterion: "C", status: "open", tests: [] },
      ]),
    );
    const evidence = [
      "End-to-end test: stock reaches the catalogue",
      "End-to-end test: pays with Stripe",
      "Strict type checking and production build",
    ];
    const report = provenOnlyByTests(
      dir,
      {
        criteria: [
          {
            criterion: "A",
            evidence: "Not verified automatically",
            verified: false,
            confidence: 0,
          },
          {
            criterion: "B",
            evidence: "End-to-end test: pays with Stripe",
            verified: true,
            confidence: 0.9,
          },
          {
            criterion: "C",
            evidence: "Strict type checking and production build",
            verified: true,
            confidence: 0.8,
          },
        ],
      },
      evidence,
    );
    expect(report.criteria.map((c) => [c.criterion, c.verified, c.evidence])).toEqual([
      ["A", true, "End-to-end test: stock reaches the catalogue"],
      ["B", true, "End-to-end test: pays with Stripe"],
      ["C", false, "Not verified automatically"],
    ]);
  });
});

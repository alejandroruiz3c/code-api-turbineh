import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dependencyList,
  REPORTS_DIR,
  skippedSteps,
  stepNote,
  toSarif,
  writeGateReports,
} from "./reports.js";

describe("gate reports shipped in the package (ADR-0055, audit F19)", () => {
  it("explains every step that shows no or a shared duration", () => {
    expect(stepNote({ name: "licenses", ms: 0 })).toMatch(/not timed separately/);
    expect(stepNote({ name: "static", ms: 4100 })).toMatch(/concurrently/);
    expect(stepNote({ name: "install", ms: 120 }, { installFromBase: true })).toMatch(/base image/);
    expect(stepNote({ name: "unit", ms: 2300 })).toBeUndefined();
  });

  it("lists the steps that did not run, with the step that stopped the sandbox", () => {
    const skipped = skippedSteps([
      { name: "install", ok: true },
      { name: "migrations", ok: true },
      { name: "lint", ok: true },
      { name: "typecheck", ok: false },
      { name: "unit", ok: true },
      { name: "build", ok: true },
      { name: "secrets", ok: true },
      { name: "static", ok: true },
      { name: "dependencies", ok: true },
      { name: "licenses", ok: true },
    ]);
    expect(skipped).toEqual([
      { name: "e2e", reason: "Not run: the sandbox stops at the first failing step (typecheck)." },
    ]);
  });

  it("writes SARIF for the static findings and a dependency list with scopes", () => {
    const sarif = toSarif(
      [{ rule: "turbineh.x", severity: "ERROR", path: "src/a.ts", line: 3, message: "m" }],
      "1.0.0",
    ) as { version: string; runs: { results: { level: string }[] }[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results[0]?.level).toBe("error");
    const deps = dependencyList(
      ["braces@3.0.3", "@next/env@16.3.8", "zod@4.6.5(typescript@5.9.3)"],
      new Set(["zod@4.6.5", "@next/env@16.3.8"]),
    );
    expect(deps).toEqual([
      {
        name: "@next/env",
        version: "16.3.8",
        purl: "pkg:npm/%40next/env@16.3.8",
        scope: "production",
      },
      { name: "braces", version: "3.0.3", purl: "pkg:npm/braces@3.0.3", scope: "development" },
      { name: "zod", version: "4.6.5", purl: "pkg:npm/zod@4.6.5", scope: "production" },
    ]);
    const dir = mkdtempSync(join(tmpdir(), "reports-"));
    const files = writeGateReports(dir, {
      ok: true,
      scannedAt: "2026-10-15T00:00:00Z",
      steps: [{ name: "licenses", ok: true, ms: 0, note: "n" }],
      skipped: [],
      findings: { secrets: 0, advisories: [], licenses: [], static: [] },
      dependencies: deps,
      semgrepVersion: "1.0.0",
    });
    expect(files).toEqual([
      `${REPORTS_DIR}/gate.json`,
      `${REPORTS_DIR}/static.sarif`,
      `${REPORTS_DIR}/dependencies.json`,
    ]);
    const gate = JSON.parse(readFileSync(join(dir, REPORTS_DIR, "gate.json"), "utf8"));
    expect(gate.steps[0].note).toBe("n");
  });
});

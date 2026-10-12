import type { VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import { alertsOf } from "./alerts.js";
import { needsRemediation } from "./remediate.js";

const result = (findings: Partial<VerifyResult["findings"]>): VerifyResult =>
  ({
    ok: true,
    steps: [],
    scannedAt: "2026-10-10T00:00:00Z",
    findings: { secrets: [], static: [], advisories: [], licenses: [], ...findings },
  }) as unknown as VerifyResult;

const advisory = (scope: "production" | "development") => ({
  id: "GHSA-test",
  pkg: "pkg@1.0.0",
  severity: "MODERATE",
  scope,
});
const warning = {
  rule: "turbineh.open-redirect",
  severity: "WARNING" as const,
  path: "src/app/page.tsx",
  line: 3,
  message: "Redirect target comes from user input.",
  explain: "Attackers can send users to a phishing site.",
};

describe("needsRemediation", () => {
  it("is false for a clean result", () => {
    expect(needsRemediation(result({}), "auto")).toBe(false);
  });
  it("always fixes static findings, warnings included", () => {
    expect(needsRemediation(result({ static: [warning] }), "auto")).toBe(true);
  });
  it("fixes production advisories automatically", () => {
    expect(needsRemediation(result({ advisories: [advisory("production")] }), "auto")).toBe(true);
  });
  it("leaves development-only advisories to the user's improve request", () => {
    const r = result({ advisories: [advisory("development")] });
    expect(needsRemediation(r, "auto")).toBe(false);
    expect(needsRemediation(r, "improve")).toBe(true);
  });
});

describe("alertsOf", () => {
  it("explains remaining alerts in plain language with their location", () => {
    const alerts = alertsOf(result({ static: [warning], advisories: [advisory("development")] }));
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ level: "warning", where: "src/app/page.tsx:3" });
    expect(alerts[1]).toMatchObject({ level: "info", where: "pkg@1.0.0" });
    expect(alerts[1]?.explain).toMatch(/not shipped to your users/);
  });
});

describe("direct model calls are rerouted, not blocked (ADR-0029)", () => {
  it("asks for the orchestrator when the app has it, otherwise to disable the call", async () => {
    const { aiRerouteGuidance } = await import("./remediate.js");
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const withAi = mkdtempSync(join(tmpdir(), "ai-"));
    mkdirSync(join(withAi, "src/lib/ai"), { recursive: true });
    writeFileSync(join(withAi, "src/lib/ai/orchestrator.ts"), "export {};\n");
    expect(aiRerouteGuidance(withAi)).toContain('from "@/lib/ai/orchestrator"');
    expect(aiRerouteGuidance(mkdtempSync(join(tmpdir(), "no-ai-")))).toContain("throw new Error");
  });

  it("never routes a direct model call to a person", async () => {
    const { triageFindings, isAiReroute } = await import("./triage.js");
    const finding = {
      rule: "turbineh.ai-direct-model-call",
      severity: "WARNING" as const,
      path: "src/x.ts",
      line: 1,
      message: "m",
      explain: "e",
    };
    expect(isAiReroute(finding)).toBe(true);
    const routes = await triageFindings([finding], undefined);
    expect([...routes.values()]).toEqual(["local"]);
  });
});

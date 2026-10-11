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

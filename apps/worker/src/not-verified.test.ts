import type { FailureAttribution } from "@turbineh/integrator";
import { parseSteps, type VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import { deliveryOf, deliveryReason, notVerifiedMarkdown } from "./not-verified.js";
import { FORCED_FAILURE_MARKER, forcedFailureRequested } from "./pipeline.js";

const SCANS = "STEP secrets 0 1\nSTEP static 0 1\nSTEP dependencies 0 1\nSTEP licenses 0 1";
const v = (tail: string): VerifyResult => {
  const steps = parseSteps(tail);
  return {
    ok: steps.every((s) => s.ok),
    steps,
    findings: { secrets: 0, advisories: [], licenses: [], static: [] },
    scannedAt: "2026-10-13T04:59:19.449Z",
  };
};
// 66af3182: 10/11 checks, one E2E test of the bookings domain component.
const GATE = v(
  `STEP install 0 1\nSTEP migrations 0 1\nSTEP lint 0 1\nSTEP typecheck 0 1\nSTEP unit 0 1\nSTEP build 0 1\nSTEP e2e 1 1\n${SCANS}`,
);
const FAILURE: FailureAttribution = {
  step: "e2e",
  message: "Error: expect(page).toHaveURL(expected) failed",
  test: "booking assistant › the staff pages refuse a signed-in non-staff person",
  file: "tests/e2e/booking-assistant.spec.ts",
  line: 174,
  owner: "component:domain.bookings.turbineh",
  imports: [],
  implicated: [],
  reason: "",
};

describe("delivered, not verified (ADR-0037 §D1)", () => {
  it("66af3182 would have been delivered: 10/11, exact test, file:line, owner and fix", () => {
    const d = deliveryOf(GATE, [FAILURE]);
    expect(d).toMatchObject({
      kind: "unverified",
      verified: false,
      checksPassed: 10,
      checksTotal: 11,
      label: "Delivered, not verified: 10/11 checks passed",
    });
    expect(d.failures).toHaveLength(1);
    const f = d.failures[0]!;
    expect(f.where).toBe("tests/e2e/booking-assistant.spec.ts:174");
    expect(f.rerun).toBe(
      'pnpm test:e2e tests/e2e/booking-assistant.spec.ts -g "the staff pages refuse a signed-in non-staff person"',
    );
    expect(f.fix).toContain(f.rerun);
    expect(f.fix).toContain("domain.bookings.turbineh");
    expect(f.fix).toContain("tests/e2e/booking-assistant.spec.ts:174");
    const reason = deliveryReason(d);
    expect(reason).toMatch(/^Delivered, not verified: 10\/11 checks passed\. Failing: e2e/);
    const md = notVerifiedMarkdown(d);
    expect(md).toContain("# Delivered, not verified: 10/11 checks passed");
    expect(md).toContain("**not verified**");
    expect(md).toContain("`tests/e2e/booking-assistant.spec.ts:174`");
  });

  it("a security block delivers the report only", () => {
    const blocked = v(`STEP e2e 0 1\n${SCANS.replace("STEP secrets 0", "STEP secrets 1")}`);
    blocked.findings.secrets = 1;
    const d = deliveryOf(blocked, []);
    expect(d.kind).toBe("report_only");
    expect(d.verified).toBe(false);
    expect(d.label).toMatch(/^Not delivered: a security or policy check blocks/);
    expect(d.blocking[0]).toMatchObject({ category: "security", rule: "gitleaks" });
    expect(notVerifiedMarkdown(d)).toContain("no runnable code was delivered");
  });

  it("a passed gate is verified and adds nothing to the report", () => {
    const ok = v(`STEP e2e 0 1\n${SCANS}`);
    const d = deliveryOf(ok, []);
    expect(d).toMatchObject({ kind: "verified", verified: true, failures: [] });
    expect(notVerifiedMarkdown(d)).toBe("");
  });

  it("the forced-failure test flag needs both the worker flag and the marker", () => {
    const prompt = `A booking site ${FORCED_FAILURE_MARKER}`;
    expect(forcedFailureRequested(prompt, { TURBINEH_TEST_FLAGS: "1" })).toBe(true);
    expect(forcedFailureRequested(prompt, {})).toBe(false);
    expect(forcedFailureRequested("A booking site", { TURBINEH_TEST_FLAGS: "1" })).toBe(false);
  });
});

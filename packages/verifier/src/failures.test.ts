import { describe, expect, it } from "vitest";
import { gateFailures, rerunCommand, testTitle } from "./failures.js";
import { parseSteps, type VerifyResult } from "./verify.js";

const result = (tail: string): VerifyResult => {
  const steps = parseSteps(tail);
  return {
    ok: steps.every((s) => s.ok),
    steps,
    findings: { secrets: 0, advisories: [], licenses: [], static: [] },
    scannedAt: "2026-10-13T00:00:00.000Z",
  };
};

// The shape of the 66af3182 failure: Playwright line reporter, one staff-only test in the bookings component.
const E2E_TAIL = `STEP lint 0 13074
STEP typecheck 0 19468
STEP unit 0 7216
STEP build 0 38485
STEP e2e 1 43357
[18/20] [chromium] › tests/e2e/booking-assistant.spec.ts:160:7 › booking assistant › books only a real free time
  1) [chromium] › tests/e2e/booking-assistant.spec.ts:174:7 › booking assistant › the staff pages refuse a signed-in non-staff person ─

    Error: expect(page).toHaveURL(expected) failed

  1 failed
    [chromium] › tests/e2e/booking-assistant.spec.ts:174:7 › booking assistant › the staff pages refuse a signed-in non-staff person ─
  19 passed (40.1s)
FAILED_LINE e2e   1) [chromium] › tests/e2e/booking-assistant.spec.ts:174:7 › booking assistant › the staff pages refuse a signed-in non-staff person ─
FAILED_LINE e2e     Error: expect(page).toHaveURL(expected) failed`;

describe("gate failures (deterministic, ADR-0037)", () => {
  it("reads the failing E2E test, file:line and error from the Playwright output", () => {
    const v = result(E2E_TAIL);
    expect(v.steps.map((s) => `${s.name}:${s.ok}`)).toEqual([
      "lint:true",
      "typecheck:true",
      "unit:true",
      "build:true",
      "e2e:false",
    ]);
    expect(v.steps.at(-1)?.detail.startsWith("  1) [chromium] › tests/e2e/")).toBe(true);
    expect(gateFailures(v)).toEqual([
      {
        step: "e2e",
        test: "booking assistant › the staff pages refuse a signed-in non-staff person",
        file: "tests/e2e/booking-assistant.spec.ts",
        line: 174,
        message: "Error: expect(page).toHaveURL(expected) failed",
      },
    ]);
    const [f] = gateFailures(v);
    expect(testTitle(f!.test!)).toBe("the staff pages refuse a signed-in non-staff person");
    expect(rerunCommand(f!)).toBe(
      'pnpm test:e2e tests/e2e/booking-assistant.spec.ts -g "the staff pages refuse a signed-in non-staff person"',
    );
  });

  it("reads Vitest failures with their location", () => {
    const v = result(`STEP unit 1 5000
 FAIL  tests/unit/bookings.test.ts > availability > never offers a slot outside opening hours
AssertionError: expected [ '19:00' ] to deeply equal []
 ❯ tests/unit/bookings.test.ts:42:18
STEP lint 0 100`);
    expect(gateFailures(v)).toEqual([
      {
        step: "unit",
        test: "availability > never offers a slot outside opening hours",
        file: "tests/unit/bookings.test.ts",
        line: 42,
        message: "AssertionError: expected [ '19:00' ] to deeply equal []",
      },
    ]);
    expect(rerunCommand(gateFailures(v)[0]!)).toBe(
      'pnpm test tests/unit/bookings.test.ts -t "never offers a slot outside opening hours"',
    );
  });

  it("falls back to file:line for type errors", () => {
    const v = result(`STEP typecheck 2 9000
src/bookings/service.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.`);
    expect(gateFailures(v)).toEqual([
      {
        step: "typecheck",
        test: null,
        file: "src/bookings/service.ts",
        line: 12,
        message:
          "src/bookings/service.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      },
    ]);
  });

  it("ignores security scans and passing steps", () => {
    const v = result("STEP lint 0 1\nSTEP e2e 0 2");
    expect(gateFailures(v)).toEqual([]);
  });
});

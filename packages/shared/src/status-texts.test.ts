import { describe, expect, it } from "vitest";
import { ellipsize, FLOW_STEPS, STATE_TEXT, verdictLabel } from "./status-texts.js";

describe("status texts (ADR-0063)", () => {
  it('never "verified" alone below 80 % functional coverage', () => {
    const checks = { passed: 11, total: 11 };
    expect(verdictLabel({ gateOk: true, met: 2, total: 5, checks })).toBe(
      "Technically verified · checks 11/11 · functional 2/5",
    );
    expect(verdictLabel({ gateOk: true, met: 7, total: 11 })).toBe(
      "Technically verified · functional 7/11",
    );
    expect(verdictLabel({ gateOk: true, met: 4, total: 5 })).toBe("Verified · functional 4/5");
    expect(
      verdictLabel({ gateOk: false, met: 5, total: 5, checks: { passed: 10, total: 11 } }),
    ).toBe("Not verified · checks 10/11 · functional 5/5");
    expect(verdictLabel({ gateOk: true, met: 0, total: 0 })).toBe("Checks passed");
  });

  it("no state label or /use step says verified without a qualifier", () => {
    for (const t of Object.values(STATE_TEXT))
      expect(t.label).not.toMatch(/^(package )?verified$|& verified$/i);
    expect(FLOW_STEPS.map(([t]) => t)).not.toContain("Verified result");
  });

  it("ellipsizes at a word boundary", () => {
    expect(ellipsize("short", 10)).toBe("short");
    const out = ellipsize("posts are shortened to fit character-x limits of each network", 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("posts are shortened to fit character-x…");
  });
});

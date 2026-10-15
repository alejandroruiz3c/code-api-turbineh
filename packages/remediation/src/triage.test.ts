import { openDecider, type Decider, type FixStrategy } from "@turbineh/decider";
import type { StaticFinding, VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import { estimateImprovement, findingKey, triageFindings } from "./triage.js";

const finding = (severity: "ERROR" | "WARNING", line: number): StaticFinding => ({
  rule: severity === "ERROR" ? "turbineh.no-eval" : "turbineh.open-redirect",
  severity,
  path: "src/app/page.tsx",
  line,
  message: "problem",
  explain: "why",
});

/** A decider whose engine answers with fixed routes / fixable verdicts, recording what it was asked. */
const decider = (routes: FixStrategy[] | null, fixable: boolean[] | null = null) => {
  const asked: unknown[] = [];
  const d: Decider & { asked: unknown[] } = {
    ...openDecider,
    asked,
    triageFindings: async (findings) => (asked.push(findings), routes),
    fixableFindings: async (findings) => (asked.push(findings), fixable),
  };
  return d;
};

describe("triageFindings", () => {
  it("never routes a blocking finding away from the fixer (the engine is not even asked)", async () => {
    const err = finding("ERROR", 1);
    const d = decider(["human"]);
    const routes = await triageFindings([err], d);
    expect(routes.get(findingKey(err))).toBe("local");
    expect(d.asked).toHaveLength(0);
  });

  it("skips a warning only when the engine routes it to a human; errors keep every fix local", async () => {
    const [a, b] = [finding("WARNING", 1), finding("WARNING", 2)];
    expect([...(await triageFindings([a, b], decider(["human", "local"]))).values()]).toEqual([
      "human",
      "local",
    ]);
    const failing = { ...decider(null), triageFindings: () => Promise.reject(new Error("down")) };
    expect([...(await triageFindings([a, b], failing)).values()]).toEqual(["local", "local"]);
    expect([...(await triageFindings([a, b], openDecider)).values()]).toEqual(["local", "local"]);
  });
});

describe("estimateImprovement", () => {
  const v = {
    findings: {
      static: [finding("WARNING", 3)],
      advisories: [
        { id: "A", pkg: "x@1.0.0", severity: "MODERATE", scope: "development" },
        { id: "B", pkg: "y@1.0.0", severity: "LOW", scope: "production" },
      ],
    },
  } as unknown as VerifyResult;

  it("counts patched dependencies deterministically and code fixes from the engine", async () => {
    const e = await estimateImprovement(v, 60_000, decider(null, [true]), async (id) => id === "A");
    expect(e).toMatchObject({ total: 3, fixable: 2, fixableProduction: 1, usesOneBuild: true });
    expect(e!.minutes.min).toBeLessThanOrEqual(e!.minutes.max);
    const open = await estimateImprovement(v, 60_000, openDecider, async (id) => id === "A");
    expect(open).toMatchObject({ total: 3, fixable: 1, fixableProduction: 0 });
  });

  it("returns null when there is nothing left", async () => {
    const clean = { findings: { static: [], advisories: [] } } as unknown as VerifyResult;
    expect(await estimateImprovement(clean, 1000, undefined, async () => true)).toBeNull();
  });
});

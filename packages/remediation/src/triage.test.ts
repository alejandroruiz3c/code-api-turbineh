import type { Decider } from "@turbineh/decider";
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

const decider = (answers: Record<string, unknown>) =>
  ({ ask: async () => ({ answers }) }) as unknown as Decider;

describe("triageFindings", () => {
  it("never routes a blocking finding away from the fixer", async () => {
    const err = finding("ERROR", 1);
    const routes = await triageFindings([err], decider({}));
    expect(routes.get(findingKey(err))).toBe("local");
  });

  it("skips a warning only when the decider is confident it needs a human", async () => {
    const [a, b] = [finding("WARNING", 1), finding("WARNING", 2)];
    const routes = await triageFindings(
      [a, b],
      decider({
        f0: { type: "choice", choice: "Needs a human decision", confidence: 0.9 },
        f1: { type: "choice", choice: "Needs a human decision", confidence: 0.5 },
      }),
    );
    expect(routes.get(findingKey(a))).toBe("human");
    expect(routes.get(findingKey(b))).toBe("local");
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

  it("counts patched dependencies deterministically and code fixes from the decider", async () => {
    const e = await estimateImprovement(
      v,
      60_000,
      decider({ w0: { type: "noul", noul: 0.8 } }),
      async (id) => id === "A",
    );
    expect(e).toMatchObject({ total: 3, fixable: 2, fixableProduction: 1, usesOneBuild: true });
    expect(e!.minutes.min).toBeLessThanOrEqual(e!.minutes.max);
  });

  it("returns null when there is nothing left", async () => {
    const clean = { findings: { static: [], advisories: [] } } as unknown as VerifyResult;
    expect(await estimateImprovement(clean, 1000, undefined, async () => true)).toBeNull();
  });
});

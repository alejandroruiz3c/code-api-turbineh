import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectStack } from "@turbineh/engine";
import { describe, expect, it } from "vitest";
import { flowPlan } from "./product.js";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../catalog/components");

/** ADR-0050: a need no template matches is built on the closest one, and the plan says what is left and where. */
describe("free-form need → buildable plan", () => {
  const plan = (scope?: { builtOn: string; reason: string }) =>
    flowPlan({
      buildId: "b-free",
      request: {
        need: "A tool where a choir tracks rehearsals, attendance and sheet music loans",
        stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
      },
      slug: "choir-tracker",
      recipeId: "saas-crud",
      selected: {},
      decisions: [],
      gaps: [],
      templateDeps: { next: "16.3.8" },
      templateEnv: "DATABASE_URL=\n",
      componentsDir,
      entities: ["Rehearsal"],
      labels: (c) => c,
      ...(scope ? { scope } : {}),
    });

  it("built on the closest template only when every requirement is covered (ADR-0052): nothing listed as left", () => {
    const p = plan({
      builtOn: "saas-crud",
      reason: "No ready-made template matches this need exactly.",
    });
    expect(p.compatible).toBe(true);
    expect(p.needsApproval).toEqual([]);
    expect(p.outcome?.actions[0]?.id).toBe("generate");
    // Uncovered parts never reach a plan as "left" work: the scope gate refuses them or removes them from scope.
    expect(p.left).toEqual([]);
  });

  it("a matched need lists nothing extra", () => {
    expect(plan().left).toEqual([]);
  });
});

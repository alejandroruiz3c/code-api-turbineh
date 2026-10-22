import { join } from "node:path";
import { separateNonFunctional, type BuildSpec } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import type { ScopeVerdict } from "@turbineh/engine";
import { canonicalizeSpec, gateDomains, planCriteria, withGeneral } from "./pipeline.js";
import { gateRequest } from "./scope.js";

/** No decision engine: the gate decides with code only (as during an engine outage). */
const offline = {
  scopeOutside: () => Promise.reject(new Error("no decision engine offline")),
} as unknown as Decider;

/**
 * The scope gate exactly as the worker runs it right after compiling (ADR-0069): general requirements separated,
 * canonical wording, the criteria shipped tests prove (recipe chain + the domain components the request selects),
 * then the gate — with code only. Used by the CI guards and the offline replay of real requests.
 */
export async function gateOffline(
  prompt: string,
  compiled: BuildSpec,
  repoRoot: string,
): Promise<{ spec: BuildSpec; proven: Set<string>; verdict: ScopeVerdict }> {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const spec = withGeneral(separateNonFunctional(compiled).spec, prompt, recipesDir);
  canonicalizeSpec(spec, recipesDir, prompt);
  const proven = new Set(
    spec.recipe === "out_of_scope"
      ? []
      : planCriteria(
          spec.acceptance_criteria,
          recipesDir,
          spec.recipe,
          gateDomains(spec, prompt, join(repoRoot, "catalog/components")),
          {
            entities: spec.entities,
            roles: spec.roles,
            about: [
              spec.app_name,
              spec.summary,
              ...spec.entities.map((e) => e.name),
              ...(spec.request_words ?? []),
            ],
          },
        )
          .filter((c) => c.status === "covered")
          .map((c) => c.criterion),
  );
  const verdict = await gateRequest({
    prompt,
    spec,
    componentsDir: join(repoRoot, "catalog/components"),
    decider: offline,
    provenByTests: proven,
  });
  return { spec, proven, verdict };
}

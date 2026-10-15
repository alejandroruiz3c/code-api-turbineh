import { RECIPE_DESCRIPTIONS, type BuildSpec } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import {
  coveredPartName,
  PLATFORM_SERVICES,
  planScope,
  scopeGate,
  type GateComponent,
  type ScopeVerdict,
} from "@turbineh/engine";
import type { Plan } from "@turbineh/shared";
import { catalogEntries } from "./product.js";

/**
 * Scope gate in the worker (ADR-0052): runs right after the request is compiled, before any selection or generation.
 * The use case is the decider's recipe (never "the closest one"); a component-only plan for an existing project is
 * gated against the components it picked.
 */
export async function gateRequest(input: {
  prompt: string;
  spec: BuildSpec;
  componentsDir: string;
  decider: Decider;
  /** Requirements a test shipped with the recipe proves (code). */
  provenByTests?: ReadonlySet<string>;
  /** Component-only plans: the ids of the components that would be delivered. */
  componentIds?: readonly string[];
  /** Components the person chose explicitly: exactly those are delivered (covered by definition). */
  explicit?: readonly string[];
}): Promise<ScopeVerdict> {
  const catalog: GateComponent[] = catalogEntries(input.componentsDir)
    .filter((c) => !PLATFORM_SERVICES.has(c.id))
    .map((c) => ({ id: c.id, provides: c.provides, does: c.does }));
  if (input.explicit?.length) {
    return scopeGate({
      need: input.prompt,
      requirements: [],
      useCase: null,
      catalog,
      explicitComponents: input.explicit,
      aiIncluded: false,
    });
  }
  const recipe = input.spec.recipe;
  const components = input.componentIds
    ? catalog.filter((c) => input.componentIds?.includes(c.id))
    : null;
  const useCase = components
    ? components.length > 0
      ? {
          id: "components",
          description: `Verified components: ${components.map((c) => `${c.id} (${c.does})`).join("; ")}`,
        }
      : null
    : recipe !== "out_of_scope"
      ? { id: recipe, description: RECIPE_DESCRIPTIONS[recipe] }
      : null;
  const aiIncluded = components
    ? components.some((c) => c.id.startsWith("ai.orchestrator"))
    : recipe === "ai-agents";
  return scopeGate(
    {
      need: input.prompt,
      requirements: input.spec.acceptance_criteria,
      useCase,
      catalog: components ?? catalog,
      ...(input.provenByTests ? { provenByTests: input.provenByTests } : {}),
      aiIncluded,
    },
    input.decider,
  );
}

/** The covered part only (explicit choice, ADR-0052): uncovered requirements removed, explicit name. */
export function coveredPart(spec: BuildSpec, verdict: ScopeVerdict): BuildSpec {
  const removed = new Set(verdict.notCovered.map((r) => r.requirement));
  return {
    ...spec,
    app_name: coveredPartName(spec.app_name),
    acceptance_criteria: spec.acceptance_criteria.filter((c) => !removed.has(c)),
  };
}

/** The plan states its scope; a partial plan needs the person's explicit choice before generation. */
export function withScope(plan: Plan, verdict: ScopeVerdict, appName: string): Plan {
  const { scope, approval } = planScope(verdict, appName);
  plan.scope = scope;
  if (!approval) return plan;
  plan.needsApproval = [approval, ...plan.needsApproval];
  plan.capability = { ...plan.capability, name: coveredPartName(plan.capability.name) };
  if (plan.outcome) {
    plan.outcome = {
      ...plan.outcome,
      title: `Only the covered part: ${scope.name}`,
      meaning: scope.message,
      actions: plan.outcome.actions.map((a) =>
        a.id === "generate"
          ? {
              ...a,
              label: "Build only the covered part",
              detail:
                "Generates and verifies only what the library covers; the requirements listed as removed are not built.",
            }
          : a,
      ),
    };
  }
  return plan;
}

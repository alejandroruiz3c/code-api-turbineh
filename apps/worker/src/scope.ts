import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RECIPE_DESCRIPTIONS, type BuildSpec } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import {
  catalogDocs,
  componentOffer,
  componentsOnlyApproval,
  coveredPartName,
  NOT_COVERED_MESSAGE,
  notCoveredExplanation,
  offerComponents,
  PLATFORM_SERVICES,
  planScope,
  scopeGate,
  type GateComponent,
  type OfferEntry,
  type OfferResult,
  type ScopeVerdict,
} from "@turbineh/engine";
import type { NotCoveredExplanation, Plan } from "@turbineh/shared";
import { parse } from "yaml";
import {
  mapToCanonical,
  readCanonical,
  requestWords,
  resolveCanonical,
  sourceIn,
} from "@turbineh/assembler";
import { catalogEntries, componentPlan, type PlanRequest } from "./product.js";

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
  // The whole approved catalogue with its guide keywords and aliases: the engine selects what is relevant per
  // requirement (it never sees a truncated list).
  const catalog: GateComponent[] = offerCatalog(input.componentsDir)
    .filter((c) => !PLATFORM_SERVICES.has(c.id))
    .map((c) => ({
      id: c.id,
      provides: c.provides,
      does: c.does,
      ...(c.docs?.keywords.length ? { keywords: c.docs.keywords } : {}),
    }));
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

/**
 * Approved components with their guide and their evidence for the components-only offer (ADR-0062): the acceptance
 * rules (acceptance.yaml) and the tested guarantees (guide.yaml) that prove what each one does.
 */
export function offerCatalog(componentsDir: string): OfferEntry[] {
  const cached = offerCatalogs.get(componentsDir);
  if (cached) return cached;
  const entries = readOfferCatalog(componentsDir);
  offerCatalogs.set(componentsDir, entries);
  return entries;
}

/** Read once per process: the catalogue in a deployed worker changes only with a deploy. */
const offerCatalogs = new Map<string, OfferEntry[]>();

function readOfferCatalog(componentsDir: string): OfferEntry[] {
  const yaml = (file: string): unknown => {
    try {
      return existsSync(file) ? parse(readFileSync(file, "utf8")) : null;
    } catch {
      return null;
    }
  };
  return catalogEntries(componentsDir).map((c) => {
    const guide = yaml(join(c.dir, "guide.yaml")) as { guarantees?: unknown } | null;
    const acceptance = yaml(join(c.dir, "acceptance.yaml"));
    return {
      ...c,
      docs: guide ? catalogDocs(guide) : null,
      acceptance: Array.isArray(acceptance)
        ? (acceptance as { test?: unknown; covers?: unknown }[])
            .filter((r) => typeof r.test === "string" && Array.isArray(r.covers))
            .map((r) => ({
              test: r.test as string,
              covers: (r.covers as unknown[]).filter((x): x is string => typeof x === "string"),
            }))
        : [],
      guarantees: Array.isArray(guide?.guarantees)
        ? (guide.guarantees as { claim?: unknown; test?: unknown }[])
            .filter((g) => typeof g.claim === "string" && typeof g.test === "string")
            .map((g) => ({ claim: g.claim as string, test: g.test as string }))
        : [],
    };
  });
}

/**
 * Uncovered use case (ADR-0062): the verified components that serve part of it (decided through the resource decision
 * engine, code without an answer) and the explanation every surface shows. `planId` is null for direct builds.
 */
export async function explainUncovered(input: {
  prompt: string;
  verdict: ScopeVerdict;
  componentsDir: string;
  decider: Decider;
  planId: string | null;
}): Promise<{ explanation: NotCoveredExplanation; result: OfferResult | null }> {
  const catalog = offerCatalog(input.componentsDir);
  const result = await offerComponents(
    {
      need: input.prompt,
      verdict: input.verdict,
      catalog,
      declared: declaredOffers(input.verdict, input.componentsDir, input.prompt),
    },
    input.decider,
  ).catch(() => null);
  const offer = result
    ? componentOffer(result, { need: input.prompt, planId: input.planId })
    : null;
  return {
    explanation: notCoveredExplanation({
      need: input.prompt,
      notCovered: input.verdict.notCovered,
      offer,
    }),
    result,
  };
}

/**
 * Requirements of an uncovered request that a component's canonical criteria describe (ADR-0063): code links them
 * (index → component, proving test), so an offer never says "not included" about a function the component's own
 * suite proves (e.g. social publishing's scheduled times and retries).
 */
export function declaredOffers(
  verdict: Pick<ScopeVerdict, "requirements">,
  componentsDir: string,
  prompt: string,
): Record<number, { id: string; test: string; gives: string }[]> {
  const ids = catalogEntries(componentsDir)
    .map((c) => c.id)
    .filter((id) => existsSync(join(componentsDir, id, "criteria.yaml")));
  const canon = ids.flatMap((id) =>
    resolveCanonical(
      readCanonical(join(componentsDir, id, "criteria.yaml"), id),
      sourceIn(join(componentsDir, id, "files")),
    ),
  );
  const out: Record<number, { id: string; test: string; gives: string }[]> = {};
  verdict.requirements.forEach((r, index) => {
    const mapped = mapToCanonical(plainRequirement(r.requirement), canon, [], requestWords(prompt));
    if (mapped.length === 0) return;
    out[index] = mapped.map((m) => ({
      id: m.from,
      test: m.tests[0] ?? "",
      gives: m.criterion,
    }));
  });
  return out;
}

const plainRequirement = (r: string) =>
  r.replace(/\s*\((the use case itself|stated in the request)\)$/, "");

/**
 * The components-only plan (ADR-0062): exactly the offered components (plus what they declare they need), each with
 * the requirements it serves; the first decision is the person's explicit choice. The use case is never built.
 */
export function offerPlan(
  buildId: string,
  request: PlanRequest,
  componentsDir: string,
  explanation: NotCoveredExplanation,
): Plan {
  const offer = explanation.offer;
  if (!offer) throw new Error("offerPlan needs an offer");
  const why = Object.fromEntries(
    offer.components.map((c) => [
      c.id,
      c.requiredBy
        ? `Required by ${c.requiredBy} — certified, audited component`
        : `Gives ${c.gives}, for: ${c.serves.map(plainRequirement).join("; ")} — proved by ${c.proof.map((p) => p.test).join("; ")}`,
    ]),
  );
  const plan = componentPlan(
    buildId,
    request,
    componentsDir,
    offer.components.filter((c) => !c.requiredBy).map((c) => c.id),
    why,
  );
  plan.capability = { ...plan.capability, name: offer.name };
  plan.scope = {
    status: "components_only",
    useCase: "components",
    name: offer.name,
    removed: offer.outOfScope,
    message: `${NOT_COVERED_MESSAGE} ${explanation.canDoNow}`,
    explanation,
  };
  plan.needsApproval = [componentsOnlyApproval(offer), ...plan.needsApproval];
  if (plan.outcome) {
    plan.outcome = {
      ...plan.outcome,
      title: offer.title,
      meaning: `${explanation.title}: ${explanation.useCase} is not built. ${offer.youGet} ${offer.notIncluded}`,
      notes: [explanation.priority, ...plan.outcome.notes],
      // Only the package can be built: "a complete app instead" would be the uncovered use case again.
      actions: plan.outcome.actions
        .filter((a) => a.id !== "build_nextjs_app")
        .map((a) =>
          a.id === "generate"
            ? {
                ...a,
                label: "Build the verified components",
                detail: `Packages exactly the offered components and runs their contract tests in the TurbineH sandbox. ${offer.notIncluded}`,
              }
            : a,
        ),
    };
  }
  return plan;
}

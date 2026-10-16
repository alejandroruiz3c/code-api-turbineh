/**
 * Relevance (ADR-0064): only capabilities justified by a requirement of the request — or by a transversal requirement
 * every app has (auth, security, persistence, interface) — reach selection. Before, "fit 100%" measured how well a
 * component fits a capability, never whether the request asked for that capability (YAML, image processing, text
 * chunking or payments in a social-media publisher). Each kept capability records what justifies it; the others are
 * listed as not selected, never silently dropped.
 *
 * Order (code first, the decision engine only for what code cannot place):
 *  1. transversal requirements declared by the recipe chain (recipe.yaml `transversal`);
 *  2. the covered use case: what its template implements and the components its code depends on;
 *  3. domain components selected from the request (their evidence sentences), non-functional requirements stated in
 *     the request;
 *  4. everything else (optional capabilities from intent classification and implied by the prompt): the decision
 *     engine's `capabilityRelevance` (criterion or stated requirement), else the open rules (`openRelevance`).
 */
import { openRelevance, type Decider, type RelevanceAnswer } from "@turbineh/decider";
import type { Justification, TransversalRequirement } from "@turbineh/shared";

export interface RelevanceRecipe {
  id: string;
  /** Capabilities the chosen use case's template implements or needs (not the base recipe's). */
  useCase: string[];
  transversal: Partial<Record<TransversalRequirement, string[]>>;
}

export interface RelevanceInput {
  summary: string;
  prompt: string;
  criteria: string[];
  /** Capabilities of the spec after recipe defaults and spec fidelity. */
  capabilities: string[];
  recipe: RelevanceRecipe;
  /** Components the build requires (recipe + domain components), capability → component id. */
  required: Record<string, string>;
  /** Evidence sentences of the request that selected each domain component (component id → sentences). */
  evidence: Record<string, string[]>;
  /** Non-functional requirements the request states, with the capabilities they map to. */
  nonFunctional: { source: string; capabilities: string[] }[];
  label: (capability: string) => string;
}

export interface RelevanceResult {
  /** capability → what justifies it (only capabilities that stay in the build). */
  justified: Record<string, Justification[]>;
  notSelected: { capability: string; label: string; reason: string }[];
  /** Who decided step 4: the decision engine, the open rules, or nobody (nothing to decide). */
  via: "decider" | "rules" | "none";
}

/** The request split into sentences (stated requirements), short ones dropped. */
export function sentencesOf(prompt: string): string[] {
  return prompt
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((s) => s.length >= 12)
    .slice(0, 40);
}

export async function justifyCapabilities(
  input: RelevanceInput,
  decider: Pick<Decider, "capabilityRelevance">,
): Promise<RelevanceResult> {
  const justified: Record<string, Justification[]> = {};
  const add = (cap: string, j: Justification) => {
    const list = (justified[cap] ??= []);
    if (!list.some((x) => x.kind === j.kind && x.ref === j.ref)) list.push(j);
  };
  for (const [req, caps] of Object.entries(input.recipe.transversal))
    for (const cap of caps ?? [])
      if (input.capabilities.includes(cap)) add(cap, { kind: "transversal", ref: req });
  for (const cap of input.recipe.useCase)
    if (input.capabilities.includes(cap) || cap in input.required)
      add(cap, { kind: "use_case", ref: input.recipe.id });
  for (const [cap, component] of Object.entries(input.required)) {
    const sentence = input.evidence[component]?.[0];
    add(
      cap,
      sentence
        ? { kind: "requirement", ref: sentence }
        : { kind: "use_case", ref: input.recipe.id },
    );
  }
  for (const nf of input.nonFunctional)
    for (const cap of nf.capabilities) add(cap, { kind: "requirement", ref: nf.source });

  const open = [...new Set([...input.capabilities, ...Object.keys(input.required)])].filter(
    (c) => !justified[c],
  );
  if (open.length === 0) return { justified, notSelected: [], via: "none" };
  const requirements = [...input.nonFunctional.map((n) => n.source), ...sentencesOf(input.prompt)];
  const question = {
    summary: input.summary,
    criteria: input.criteria,
    requirements,
    capabilities: open.map((id) => ({ id, label: input.label(id) })),
  };
  let answer: RelevanceAnswer | null = null;
  let via: RelevanceResult["via"] = "rules";
  if (decider.capabilityRelevance) {
    answer = await decider.capabilityRelevance(question).catch(() => null);
    if (answer) via = "decider";
  }
  const rules = openRelevance(question);
  const notSelected: RelevanceResult["notSelected"] = [];
  for (const cap of open) {
    // The engine's answer wins; a capability it did not answer is decided by the open rules.
    const a = answer?.justified[cap] ?? rules.justified[cap];
    const by = a?.by ?? null;
    const ref = by
      ? by.kind === "criterion"
        ? input.criteria[by.index]
        : requirements[by.index]
      : undefined;
    if (by && ref) add(cap, { kind: by.kind, ref });
    else
      notSelected.push({
        capability: cap,
        label: input.label(cap),
        reason: "No requirement of the request asks for it",
      });
  }
  return { justified, notSelected, via };
}

/** Capabilities of the chosen use case: what its template implements or needs beyond the base recipe. */
export function useCaseCapabilities(
  chain: readonly {
    extends: string | null;
    defaultCapabilities: string[];
    providedCapabilities?: string[];
    requiredComponents?: Record<string, string>;
  }[],
): string[] {
  const overlays = chain.filter((m) => m.extends !== null);
  return [
    ...new Set([
      ...overlays.flatMap((m) => m.defaultCapabilities),
      ...chain.flatMap((m) => m.providedCapabilities ?? []),
      ...chain.flatMap((m) => Object.keys(m.requiredComponents ?? {})),
    ]),
  ];
}

/** Request sentences that selected each domain component (spec fidelity patterns): component id → sentences. */
export function patternEvidence(
  fidelity: {
    fidelity: { patterns: { id: string; evidence: string[] }[] };
    wired: { patterns: { id: string; component: string | null; status: string }[] };
  } | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of fidelity?.wired.patterns ?? []) {
    if (w.status !== "selected" || !w.component) continue;
    const ev = fidelity?.fidelity.patterns.find((p) => p.id === w.id)?.evidence ?? [];
    if (ev.length) out[w.component] = [...(out[w.component] ?? []), ...ev];
  }
  return out;
}

/**
 * Generation from an approved plan: the plan's justifications are reused as approved (no second decision), so the
 * generated package is the plan the person approved. Capabilities the plan never saw are returned as `unknown`.
 */
export function fromApproved(
  approved: {
    entries: { capability: string; justifiedBy: Justification[] }[];
    notSelected: RelevanceResult["notSelected"];
  },
  capabilities: readonly string[],
): { result: RelevanceResult; unknown: string[] } {
  const justified: Record<string, Justification[]> = {};
  for (const e of approved.entries)
    if (e.justifiedBy.length) justified[e.capability] = [...e.justifiedBy];
  const known = new Set([
    ...approved.entries.map((e) => e.capability),
    ...approved.notSelected.map((n) => n.capability),
  ]);
  return {
    result: { justified, notSelected: [...approved.notSelected], via: "none" },
    unknown: capabilities.filter((c) => !known.has(c)),
  };
}

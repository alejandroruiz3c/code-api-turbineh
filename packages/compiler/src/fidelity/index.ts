import type { Decider } from "@turbineh/decider";
import type { BuildSpec } from "../build-spec.js";
import type { DomainSelection } from "../domains.js";
import { extractConstraints, type Constraints } from "./constraints.js";
import {
  applyEntityModel,
  classifyEntities,
  decideUnsureKinds,
  type EntityModel,
} from "./entity-kinds.js";
import { extractPermissions, type PermissionMatrix } from "./permissions.js";
import {
  detectPatterns,
  PATTERN_CAPABILITIES,
  type PatternId,
  type PatternMatch,
} from "./patterns.js";

export * from "./constraints.js";
export * from "./entity-kinds.js";
export * from "./field-policy.js";
export * from "./permissions.js";
export * from "./patterns.js";
export * from "./wiring.js";

/** Spec fidelity (ADR-0042): what the request says, modelled by code, for the assembler and the agent guide. */
export interface Fidelity {
  entities: EntityModel[];
  permissions: PermissionMatrix;
  constraints: Constraints;
  patterns: PatternMatch[];
  /** Decider use for the entity kinds (0 when the rules were conclusive). */
  decider: { asked: number; latencyMs: number };
}

export interface FidelityOptions {
  recipe?: string;
  /** Entities the recipe implements (parents such as Task or Project). */
  knownEntities?: readonly string[];
  /** Asked only about entities the rules are unsure of. */
  decider?: Decider | null;
}

/**
 * Models the request (deterministic, decider only for unsure entity kinds) and returns the spec with tag entities
 * folded into their parent's `tags` field.
 */
export async function specFidelity(
  prompt: string,
  spec: BuildSpec,
  opts: FidelityOptions = {},
): Promise<{ spec: BuildSpec; fidelity: Fidelity }> {
  const classified = classifyEntities(spec, prompt, { knownEntities: opts.knownEntities ?? [] });
  const decided = await decideUnsureKinds(classified, spec, prompt, opts.decider);
  return finish(prompt, spec, decided.models, opts, {
    asked: decided.asked,
    latencyMs: decided.latencyMs,
  });
}

/** Same as `specFidelity` without any decider (offline checks, the CLI, tests). */
export function specFidelitySync(
  prompt: string,
  spec: BuildSpec,
  opts: Omit<FidelityOptions, "decider"> = {},
): { spec: BuildSpec; fidelity: Fidelity } {
  const classified = classifyEntities(spec, prompt, { knownEntities: opts.knownEntities ?? [] });
  return finish(prompt, spec, classified, opts, { asked: 0, latencyMs: 0 });
}

function finish(
  prompt: string,
  spec: BuildSpec,
  entities: EntityModel[],
  opts: FidelityOptions,
  decider: Fidelity["decider"],
): { spec: BuildSpec; fidelity: Fidelity } {
  const permissions = extractPermissions(prompt, spec.roles);
  const constraints = extractConstraints(prompt);
  const modelled = applyStatusOptions(applyEntityModel(spec, entities), constraints, entities);
  const patterns = detectPatterns({
    prompt,
    recipe: opts.recipe ?? spec.recipe,
    appName: spec.app_name,
    spec,
    entities,
    permissions,
    constraints,
    knownEntities: opts.knownEntities ?? [],
  });
  return { spec: modelled, fidelity: { entities, permissions, constraints, patterns, decider } };
}

/**
 * Status lists from the request become the options of the matching enum field ("status", "stage") of the entity the
 * list belongs to (or of the only entity with such a field). Recorded in `options` so the generator renders a select.
 */
function applyStatusOptions(spec: BuildSpec, c: Constraints, models: EntityModel[]): BuildSpec {
  if (c.statusLists.length === 0) return spec;
  const business = new Set(models.filter((m) => m.kind === "business").map((m) => m.name));
  let changed = false;
  const entities = spec.entities.map((e) => {
    if (!business.has(e.name)) return e;
    const fields = e.fields.map((f) => {
      const list =
        c.statusLists.find(
          (l) =>
            new RegExp(`^(current)?${l.field}$`, "i").test(f.name) &&
            (!l.of ||
              l.of.split(" ").some((w) => e.name.toLowerCase().includes(w.replace(/s$/, "")))),
        ) ?? c.statusLists.find((l) => new RegExp(`^(current)?${l.field}$`, "i").test(f.name));
      if (!list || !["enum", "string"].includes(f.type)) return f;
      changed = true;
      return { ...f, type: "enum" as const, options: list.values };
    });
    return { ...e, fields };
  });
  return changed ? { ...spec, entities } : spec;
}

/** Minimal catalog card the selection needs (approved components only are considered). */
export interface PatternCatalogEntry {
  id: string;
  status: string;
  provides: string[];
  /** contract.inputs of the manifest: a `src/…/params.json` path there is where the params go. */
  inputs?: string[];
  /** Recipes it is tested with / declared for (empty = any). */
  recipes?: string[];
}

export interface PatternSelection {
  selected: DomainSelection[];
  /** Patterns the request describes whose component is not in the catalog yet (criteria stay open). */
  missing: { id: PatternId; capabilities: string[]; params: Record<string, unknown> }[];
}

/**
 * Selects the catalog component for each detected pattern, by code: an approved component providing one of the
 * pattern's capabilities. Absent components are reported, never invented.
 */
export function selectPatternComponents(
  patterns: readonly PatternMatch[],
  catalog: readonly PatternCatalogEntry[],
  recipe: string,
): PatternSelection {
  const selected: DomainSelection[] = [];
  const missing: PatternSelection["missing"] = [];
  for (const p of patterns) {
    const caps = PATTERN_CAPABILITIES[p.id];
    let hit: { c: PatternCatalogEntry; cap: string } | null = null;
    for (const cap of caps) {
      const c = catalog.find((x) => x.status === "approved" && x.provides.includes(cap));
      if (c) {
        hit = { c, cap };
        break;
      }
    }
    if (!hit) {
      missing.push({ id: p.id, capabilities: caps, params: p.params });
      continue;
    }
    const paramsFile =
      (hit.c.inputs ?? [])
        .map((i) => /\b(src\/[\w./-]+params\.json)\b/.exec(i)?.[1])
        .find(Boolean) ?? `src/${p.id.replace(/\./g, "-")}/params.json`;
    selected.push({
      id: p.id,
      capability: hit.cap,
      component: hit.c.id,
      recipes: [recipe],
      paramsFile,
      params: p.params,
      providedEntities: p.providedEntities,
      assumptions: p.assumptions,
    });
  }
  return { selected, missing };
}

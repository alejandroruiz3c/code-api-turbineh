/**
 * Spec fidelity in the build (ADR-0043): models the request (entity kinds, roles and rules, constraints, domain
 * patterns), selects by code the catalog component of each pattern with params validated against its
 * params.schema.json, and returns what the assembler needs. Shared by the pipeline and `verify:spec`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FidelityAssembly } from "@turbineh/assembler";
import { readParamsDecl, validateParams } from "@turbineh/catalog";
import {
  impliedCapabilities,
  specFidelity,
  specFidelitySync,
  wirePatterns,
  type BuildSpec,
  type ComponentCard,
  type DomainSelection,
  type Fidelity,
  type WiredSelection,
} from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import { parse } from "yaml";

interface Manifest {
  id: string;
  status: string;
  contract?: { inputs?: string[] };
  capability?: { use_cases?: string[] };
  relations?: { provides?: string[] };
  params?: { file?: string; schema?: string; entities?: string[] };
}

/** Catalog components as the pattern selection needs them (manifest + params declaration). Read on every call. */
export function componentCards(componentsDir: string): ComponentCard[] {
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(componentsDir, d.name, "component.yaml")))
    .map((d) => {
      const m = parse(readFileSync(join(componentsDir, d.name, "component.yaml"), "utf8")) as Manifest;
      const decl = m.params ?? null;
      return {
        id: m.id,
        status: m.status,
        provides: m.relations?.provides ?? [],
        paramsFile: decl?.file ?? null,
        hasSchema: Boolean(decl?.schema && existsSync(join(componentsDir, d.name, decl.schema))),
        entities: decl?.entities ?? [],
        inputs: m.contract?.inputs ?? [],
        recipes: [
          ...new Set([...(m.capability?.use_cases ?? []), ...guideRecipes(join(componentsDir, d.name))]),
        ],
      };
    });
}

/** compatibility.recipes of the component's guide.yaml. */
function guideRecipes(dir: string): string[] {
  const file = join(dir, "guide.yaml");
  if (!existsSync(file)) return [];
  const g = parse(readFileSync(file, "utf8")) as { compatibility?: { recipes?: string[] } } | null;
  return g?.compatibility?.recipes ?? [];
}

/** The params a component ships as its default (files/<params.file>), or null. */
function shippedDefaults(componentsDir: string, id: string): Record<string, unknown> | null {
  const decl = readParamsDecl(join(componentsDir, id));
  const file = decl ? join(componentsDir, id, "files", decl.file) : "";
  if (!decl || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface WiredFidelity {
  /** The spec with tag entities folded into their parent and status lists as enum options, plus implied capabilities. */
  spec: BuildSpec;
  fidelity: Fidelity;
  wired: WiredSelection;
  /** For the assembler (fidelity + every pattern's status). */
  assembly: FidelityAssembly;
}

function wire(
  prompt: string,
  modelled: { spec: BuildSpec; fidelity: Fidelity },
  recipeId: string,
  componentsDir: string,
  recipeChain: string[],
  exclude: readonly string[] = [],
): WiredFidelity {
  const { fidelity } = modelled;
  const cards = componentCards(componentsDir).filter((c) => !exclude.includes(c.id));
  const wired = wirePatterns(fidelity.patterns, cards, {
    recipe: recipeId,
    recipeChain,
    spec: modelled.spec,
    permissions: fidelity.permissions,
    constraints: fidelity.constraints,
    validate: (id, params) => validateParams(join(componentsDir, id), params),
    defaults: (id) => shippedDefaults(componentsDir, id),
  });
  const spec: BuildSpec = {
    ...modelled.spec,
    capabilities: [
      ...new Set([...modelled.spec.capabilities, ...impliedCapabilities(prompt)]),
    ] as BuildSpec["capabilities"],
  };
  return { spec, fidelity, wired, assembly: { fidelity, patterns: wired.patterns } };
}

/** Pipeline: the decider is asked only about entities the rules are unsure of (ADR-0042 §1). */
export async function wireFidelity(
  prompt: string,
  spec: BuildSpec,
  opts: {
    recipeId: string;
    recipeChain: string[];
    componentsDir: string;
    knownEntities: string[];
    decider?: Decider | null;
  },
): Promise<WiredFidelity> {
  const modelled = await specFidelity(prompt, spec, {
    recipe: opts.recipeId,
    knownEntities: opts.knownEntities,
    decider: opts.decider ?? null,
  });
  return wire(prompt, modelled, opts.recipeId, opts.componentsDir, opts.recipeChain);
}

/** Offline (verify:spec, tests): no decider, the rules' answer stands. */
export function wireFidelitySync(
  prompt: string,
  spec: BuildSpec,
  opts: {
    recipeId: string;
    recipeChain: string[];
    componentsDir: string;
    knownEntities: string[];
    /** Components treated as absent (verify:spec --without: exercises the generic fallbacks). */
    exclude?: string[];
  },
): WiredFidelity {
  const modelled = specFidelitySync(prompt, spec, {
    recipe: opts.recipeId,
    knownEntities: opts.knownEntities,
  });
  return wire(prompt, modelled, opts.recipeId, opts.componentsDir, opts.recipeChain, opts.exclude);
}

/**
 * Domain components of the build: the patterns' selections, then the legacy domain detector's (e.g. bookings) for
 * components no pattern selected. One entry per component.
 */
export function mergeDomains(
  wired: readonly DomainSelection[],
  detected: readonly DomainSelection[],
): DomainSelection[] {
  const out = wired.map((w) => {
    const same = detected.find((d) => d.component === w.component);
    return same
      ? { ...w, providedEntities: [...new Set([...w.providedEntities, ...same.providedEntities])] }
      : w;
  });
  for (const d of detected) if (!out.some((x) => x.component === d.component)) out.push(d);
  return out;
}

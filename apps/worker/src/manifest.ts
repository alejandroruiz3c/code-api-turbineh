/**
 * Builds the delivery manifest (ADR-0064) from the pipeline's real selection: one entry per capability of the build —
 * a verified component, the use case's template, code TurbineH writes, or not included (with why) — each with what in
 * the request justifies it. The plan, the result, "Next steps", DEPLOY.md, AGENTS.md, turbineh.json, the web and the
 * CLI are rendered from it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { componentModules, hasPublicToolkit, type RecipeModule } from "@turbineh/assembler";
import { backupMayFill } from "@turbineh/integrator";
import {
  DELIVERY_SCHEMA,
  appSettings,
  type DeliveryManifest,
  type Justification,
  type ManifestEntry,
} from "@turbineh/shared";

export interface ManifestInput {
  recipe: string;
  criteria: string[];
  /** Capabilities of the build (justified ones only). */
  capabilities: string[];
  justified: Record<string, Justification[]>;
  notSelected: DeliveryManifest["notSelected"];
  /** Capabilities the recipe template implements itself. */
  provided: readonly string[];
  /** Resolution: capability → selected component. */
  selected: Record<string, { id: string; requires?: string[] }>;
  /** Capabilities without a usable component, with the selection trigger (T1/T2) when there is one. */
  gaps: { capability: string; trigger: string | null }[];
  /** Every capability an approved catalogue component provides. */
  catalogued: ReadonlySet<string>;
  env: DeliveryManifest["env"];
  label: (capability: string) => string;
  /** True when this manifest is the plan the person approves (its promises bind the generation). */
  approved: boolean;
}

/** Why a capability without a usable component is not included (never "TurbineH writes it" when it will not). */
export function notIncludedReason(capability: string, catalogued: ReadonlySet<string>): string {
  if (catalogued.has(capability))
    return "a verified component provides it, but none can be used in this app (version or compatibility)";
  if (/^ops\.idempotency$|dedup/.test(capability))
    return "it needs stored state with a unique constraint and no verified component provides it yet — TurbineH does not write it as glue";
  return "no verified component provides it yet, and TurbineH writes only small helpers (data, files, ops, jobs) as glue — never sign-in, security, payments, email or interface code";
}

export function buildManifest(input: ManifestInput): DeliveryManifest {
  const entries: ManifestEntry[] = [];
  const add = (e: Omit<ManifestEntry, "status" | "label">) => {
    if (entries.some((x) => x.capability === e.capability)) return;
    entries.push({ ...e, label: input.label(e.capability), status: "planned" });
  };
  const why = (cap: string) => [...(input.justified[cap] ?? [])];
  // Capabilities another selected component requires (manifest `relations.requires`) are justified by it too.
  const requiredBy = (cap: string, id: string): Justification[] =>
    Object.values(input.selected)
      .filter(
        (c) => c.id !== id && ((c.requires ?? []).includes(cap) || (c.requires ?? []).includes(id)),
      )
      .map((c) => ({ kind: "required_by" as const, ref: c.id }));
  for (const [cap, c] of Object.entries(input.selected))
    add({
      capability: cap,
      way: "component",
      component: c.id,
      justifiedBy: [...why(cap), ...requiredBy(cap, c.id)],
    });
  for (const cap of input.capabilities.filter((c) => input.provided.includes(c)))
    add({ capability: cap, way: "recipe", component: null, justifiedBy: why(cap) });
  for (const g of input.gaps) {
    const writable =
      backupMayFill(g.capability, input.catalogued) && (g.trigger === "T1" || g.trigger === "T2");
    add(
      writable
        ? {
            capability: g.capability,
            way: "written",
            component: null,
            justifiedBy: why(g.capability),
          }
        : {
            capability: g.capability,
            way: "not_included",
            component: null,
            justifiedBy: why(g.capability),
            reason: notIncludedReason(g.capability, input.catalogued),
          },
    );
  }
  return {
    schema: DELIVERY_SCHEMA,
    recipe: input.recipe,
    approved: input.approved,
    entries,
    criteria: [...input.criteria],
    env: input.env,
    notSelected: input.notSelected,
    brokenPromises: [],
  };
}

/**
 * Settings of an app before it is assembled (plans): the env schema of the recipe chain's src/env.ts and its
 * .env.example plus the settings each selected native component appends — exactly what assembly writes.
 */
export function plannedEnv(input: {
  recipesDir: string;
  componentsDir: string;
  chain: string[];
  components: string[];
  /** Settings of modules tree-shaken away (never in the app). */
  dropped?: readonly string[];
}): DeliveryManifest["env"] {
  const last = (rel: string) =>
    [...input.chain]
      .reverse()
      .map((id) => join(input.recipesDir, id, "template", rel))
      .find((f) => existsSync(f));
  const read = (f: string | undefined) => (f ? readFileSync(f, "utf8") : "");
  let example = read(last(".env.example"));
  for (const id of input.components) {
    const append = join(input.componentsDir, id, "files", ".env.example.append");
    if (existsSync(append)) example += `\n${readFileSync(append, "utf8")}`;
  }
  const env = appSettings({ envTs: read(last("src/env.ts")), envExample: example });
  const keep = (e: { name: string }) => !(input.dropped ?? []).includes(e.name);
  return { required: env.required.filter(keep), optional: env.optional.filter(keep) };
}

/**
 * Modules assembly will remove (ADR-0064): recipe modules whose capability nothing justifies, and component modules
 * whose condition does not hold (the public assistant without a public toolkit) — known before assembly, so the plan
 * lists exactly the settings the delivered app has.
 */
export function removedModules(input: {
  recipe: { modules?: RecipeModule[] };
  keptCapabilities: ReadonlySet<string>;
  componentsDir: string;
  components: readonly string[];
}): RecipeModule[] {
  const fromRecipe = (input.recipe.modules ?? []).filter(
    (m) => !input.keptCapabilities.has(m.capability),
  );
  const ai = input.components.includes("ai.orchestrator.turbineh");
  const publicToolkit =
    ai &&
    input.components.some((id) =>
      ["files", "files-ai"].some((d) => hasPublicToolkit(join(input.componentsDir, id, d))),
    );
  const fromComponents = input.components
    .flatMap((id) => componentModules(join(input.componentsDir, id), id))
    .filter((m) =>
      m.when === "public-toolkit" ? !publicToolkit : !input.keptCapabilities.has(m.capability),
    );
  return [...fromRecipe, ...fromComponents];
}

/** A manifest with nothing decided (tests and plans without a selection). */
export const emptyDelivery = (recipe: string): DeliveryManifest => ({
  schema: DELIVERY_SCHEMA,
  recipe,
  approved: true,
  entries: [],
  criteria: [],
  env: { required: [], optional: [] },
  notSelected: [],
  brokenPromises: [],
});

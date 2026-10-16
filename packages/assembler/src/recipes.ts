import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { RecipeGuide } from "./agent-guide.js";

export interface RecipeMeta {
  id: string;
  description: string;
  extends: string | null;
  /** Entities the recipe already implements; the generator never duplicates them. */
  providedEntities: string[];
  /** Capabilities every build of this recipe needs (added to the BuildSpec by code). */
  defaultCapabilities: string[];
  /**
   * Capabilities the recipe template implements itself (e.g. password hashing inside better-auth). They are never
   * sent to selection and never reported as gaps.
   */
  providedCapabilities?: string[];
  /**
   * Native components the template code depends on (capability → component id), e.g. the AI orchestrator and its
   * AI Safety Pack (ADR-0028). Selected by code in every build of the recipe, never left to the decider.
   */
  requiredComponents?: Record<string, string>;
  /**
   * Transversal requirements (ADR-0064): capabilities every app of the recipe needs whatever the request says, by
   * requirement (auth, security, persistence, interface). They justify those capabilities in the delivery manifest.
   */
  transversal?: Partial<Record<"auth" | "security" | "persistence" | "interface", string[]>>;
  /**
   * Optional modules of the template (ADR-0064, tree-shaking): parts that ship only when a requirement of the request
   * asks for them. Each lists its files (removed otherwise) and the blocks of shared files marked
   * `turbineh:module <id>` / `turbineh:end-module <id>`.
   */
  modules?: RecipeModule[];
  /** Extra dashboard navigation entries. */
  nav: { label: string; href: string }[];
  /** Agent guide inputs (AGENTS.md / turbineh.json): recipe-specific extension points. */
  guide?: RecipeGuide;
}

export interface RecipeModule {
  id: string;
  /** What it is, in plain words (shown when it is removed). */
  about: string;
  /** Capability it delivers: the module ships only when that capability is justified by the request. */
  capability: string;
  /** Files of the module (relative to the app), removed with it. Directories end with "/". */
  files: string[];
  /** Settings only this module reads, dropped from .env.example with it. */
  env?: string[];
  /** Navigation entries (href) only this module adds. */
  nav?: string[];
  /** Provided capabilities of the template that only this module implements (not claimed when it is removed). */
  provides?: string[];
}

export function readRecipe(recipesDir: string, id: string): RecipeMeta {
  const file = join(recipesDir, id, "recipe.yaml");
  if (!existsSync(file)) throw new Error(`unknown recipe ${id}`);
  return parse(readFileSync(file, "utf8")) as RecipeMeta;
}

export function hasRecipe(recipesDir: string, id: string): boolean {
  return existsSync(join(recipesDir, id, "recipe.yaml"));
}

/** Parent-first chain, e.g. [saas-crud, landing-waitlist]. */
export function recipeChain(recipesDir: string, id: string): RecipeMeta[] {
  const chain: RecipeMeta[] = [];
  for (let cur: string | null = id; cur;) {
    const meta = readRecipe(recipesDir, cur);
    if (chain.some((m) => m.id === meta.id)) throw new Error(`recipe cycle at ${meta.id}`);
    chain.unshift(meta);
    cur = meta.extends;
  }
  return chain;
}

/** Copies every template in the chain (parent first, overlays win) into `outDir`. */
export function materializeRecipe(recipesDir: string, id: string, outDir: string): RecipeMeta[] {
  const chain = recipeChain(recipesDir, id);
  for (const meta of chain) {
    cpSync(join(recipesDir, meta.id, "template"), outDir, { recursive: true });
  }
  return chain;
}

/** Merged metadata of a chain (union of provided entities, default capabilities and nav). */
export function mergedRecipe(chain: RecipeMeta[]): Omit<RecipeMeta, "extends"> {
  const last = chain[chain.length - 1];
  return {
    id: last?.id ?? "",
    description: last?.description ?? "",
    providedEntities: [...new Set(chain.flatMap((m) => m.providedEntities))],
    defaultCapabilities: [...new Set(chain.flatMap((m) => m.defaultCapabilities))],
    providedCapabilities: [...new Set(chain.flatMap((m) => m.providedCapabilities ?? []))],
    requiredComponents: Object.assign(
      {},
      ...chain.map((m) => m.requiredComponents ?? {}),
    ) as Record<string, string>,
    transversal: Object.fromEntries(
      (["auth", "security", "persistence", "interface"] as const).map((k) => [
        k,
        [...new Set(chain.flatMap((m) => m.transversal?.[k] ?? []))],
      ]),
    ),
    modules: chain.flatMap((m) => m.modules ?? []),
    nav: chain.flatMap((m) => m.nav),
    // Most specific recipe first.
    guide: { extend: [...chain].reverse().flatMap((m) => m.guide?.extend ?? []) },
  };
}

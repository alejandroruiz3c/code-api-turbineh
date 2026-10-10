import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface RecipeMeta {
  id: string;
  description: string;
  extends: string | null;
  /** Entities the recipe already implements; the generator never duplicates them. */
  providedEntities: string[];
  /** Capabilities every build of this recipe needs (added to the BuildSpec by code). */
  defaultCapabilities: string[];
  /** Extra dashboard navigation entries. */
  nav: { label: string; href: string }[];
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
    nav: chain.flatMap((m) => m.nav),
  };
}

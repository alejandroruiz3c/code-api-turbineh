/**
 * Recipe + component combinations, assembled exactly as the pipeline assembles them (ADR-0037 §D4). A change to one
 * catalog component can break another one only when both are assembled together (66af3182: a bookings-domain E2E
 * test broke against the ai-agents recipe's staff default). `verify:recipe` and CI check every combination, so such a
 * regression is caught before main, not in a client build.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assemble, mergedRecipe, recipeChain, type SelectedComponent } from "@turbineh/assembler";
import { ALWAYS_ON, detectDomains, extractPalette, type BuildSpec } from "@turbineh/compiler";
import type { CandidateCard } from "@turbineh/selector";
import { loadCatalog } from "./catalog-source.js";

/**
 * One representative request per domain component: the request that makes the compiler select it. A new domain
 * component adds its probe here (checked by `combinations.test.ts`).
 */
export const DOMAIN_PROBES: Record<string, string> = {
  "domain.bookings.turbineh":
    'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute ' +
    "sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check " +
    "availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours " +
    "before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring). The assistant " +
    "must use tools over the clinic's real data (availability, create/move/cancel booking, find booking by email) and " +
    "never invent a slot; it confirms details before booking and sends a confirmation email. Staff sign in to see and " +
    "manage the bookings. The assistant's language model is reached through an OpenAI-compatible endpoint configured by " +
    "environment variables; tests must use a local mock of that endpoint (no internet in tests). Protect it against " +
    "prompt injection and abuse (input limits, rate limits).",
};

export interface Combination {
  /** "ai-agents" or "ai-agents+domain.bookings.turbineh". */
  name: string;
  recipe: string;
  prompt: string;
}

/** Every recipe alone, plus every recipe a domain component's probe selects it for. */
export function combinations(repoRoot: string): Combination[] {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const recipes = readdirSync(recipesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(recipesDir, d.name, "recipe.yaml")))
    .map((d) => d.name)
    .sort();
  const out: Combination[] = recipes.map((recipe) => ({ name: recipe, recipe, prompt: "" }));
  for (const recipe of recipes) {
    for (const [component, prompt] of Object.entries(DOMAIN_PROBES)) {
      if (detectDomains(prompt, recipe).some((d) => d.component === component)) {
        out.push({ name: `${recipe}+${component}`, recipe, prompt });
      }
    }
  }
  return out;
}

/** The minimal spec used for template checks (no models involved). */
export function checkSpec(recipe: string, prompt: string): BuildSpec {
  return {
    recipe: recipe as BuildSpec["recipe"],
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Recipe Check",
    slug: "recipe-check",
    summary: `Verification of the ${recipe} recipe template.`,
    roles: ["owner"],
    entities: [],
    pages: [{ path: "/", purpose: "Home", auth_required: false }],
    capabilities: ["security.headers", "data.validation"],
    acceptance_criteria: [
      "Owner signs in and reaches the dashboard",
      "Anonymous users are sent to sign-in",
      "Every action checks the workspace",
    ],
    site: null,
    palette: extractPalette(prompt),
  };
}

/**
 * Native components the pipeline vendors for this recipe and request, chosen by code as the pipeline does: the
 * recipe's required components, the detected domain components, native components for the recipe's default and
 * always-on capabilities, their `requires`, and `extra` ids (--with).
 */
export function nativeSelection(
  repoRoot: string,
  recipe: string,
  prompt: string,
  extra: string[] = [],
): { selected: SelectedComponent[]; domains: ReturnType<typeof detectDomains> } {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const merged = mergedRecipe(recipeChain(recipesDir, recipe));
  const catalog = loadCatalog(join(repoRoot, "catalog/components"), { cards: "oneliner" });
  const approved = (c: CandidateCard) => c.status === "approved";
  const native = (c: CandidateCard) => c.pkg.name.startsWith("turbineh/");
  const domains = detectDomains(prompt, recipe, "Recipe Check");
  const ids = new Set<string>([
    ...Object.values(merged.requiredComponents ?? {}),
    ...domains.map((d) => d.component),
    ...extra,
  ]);
  const provided = new Set(merged.providedCapabilities ?? []);
  for (const cap of [...merged.defaultCapabilities, ...ALWAYS_ON]) {
    if (provided.has(cap)) continue;
    const c = catalog.find((x) => approved(x) && native(x) && x.provides.includes(cap));
    if (c) ids.add(c.id);
  }
  // Requirements between components (e.g. the orchestrator requires the AI Safety Pack).
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...ids]) {
      for (const r of catalog.find((x) => x.id === id)?.requires ?? []) {
        if (!ids.has(r) && catalog.some((x) => x.id === r)) {
          ids.add(r);
          changed = true;
        }
      }
    }
  }
  const selected = [...ids].map((id): SelectedComponent => {
    const c = catalog.find((x) => x.id === id);
    if (!c) throw new Error(`unknown component ${id}`);
    return {
      capability: c.provides[0] ?? id.split(".").slice(0, 2).join("."),
      component: c,
      why: { pBest: 1, covers: 1, risk: 0 },
    };
  });
  return { selected, domains };
}

/** Assembles one combination into `outDir` the way the pipeline does. */
export function assembleCombination(
  repoRoot: string,
  c: Pick<Combination, "recipe" | "prompt">,
  outDir: string,
  extra: string[] = [],
): { components: string[]; domains: string[] } {
  const { selected, domains } = nativeSelection(repoRoot, c.recipe, c.prompt, extra);
  assemble({
    buildId: "recipe-check",
    recipesDir: join(repoRoot, "catalog/recipes"),
    recipe: c.recipe,
    outDir,
    spec: checkSpec(c.recipe, c.prompt),
    selected,
    gaps: [],
    domains,
  });
  return {
    components: selected.map((s) => s.component.id),
    domains: domains.map((d) => d.component),
  };
}

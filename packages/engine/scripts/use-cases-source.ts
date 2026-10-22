import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { CatalogTotals, UseCase, UseCaseAddOn } from "../src/types.js";

/**
 * A function shown on product surfaces (ADR-0076): one readable label for the canonical criteria (ADR-0063) that prove
 * it, each linked to its tests. Only `label` reaches the generated file; the proof is for the CI checks.
 */
export interface FunctionSource {
  label: string;
  /** Canonical criterion ids (recipe or component criteria.yaml). */
  criteria: string[];
  /** Linked tests ("file › title"), or `generated: <pattern>` for per-entity generated tests. */
  proof: string[];
}

export interface AddOnSource extends Omit<UseCaseAddOn, "functions"> {
  functions: FunctionSource[];
}

export interface UseCaseSource extends Omit<UseCase, "functions" | "addOns"> {
  functions: FunctionSource[];
  addOns: AddOnSource[];
}

/** Words people use for each use case (search by need, PLAN §16 "Descubrir"). */
const KEYWORDS: Record<string, string[]> = {
  "saas-crud": [
    "saas",
    "crud",
    "admin",
    "records",
    "multi-tenant",
    "workspace",
    "management",
    "app",
    "manage",
  ],
  "internal-tool": [
    "internal",
    "tool",
    "backoffice",
    "back office",
    "operations",
    "staff",
    "admin panel",
    "inventory",
  ],
  "landing-waitlist": [
    "landing",
    "waitlist",
    "launch",
    "signup",
    "lead",
    "marketing page",
    "pre-launch",
  ],
  bookings: [
    "booking",
    "bookings",
    "appointment",
    "reservation",
    "calendar",
    "schedule",
    "clinic",
    "salon",
    "availability",
  ],
  "client-portal": [
    "portal",
    "client portal",
    "customer portal",
    "documents",
    "invoices",
    "clients",
    "agency",
  ],
  "corporate-site": [
    "corporate",
    "company website",
    "website",
    "site",
    "cms",
    "blog",
    "seo",
    "brochure",
  ],
  storefront: [
    "ecommerce",
    "e-commerce",
    "shop",
    "store",
    "checkout",
    "cart",
    "products",
    "payments",
    "stripe",
    "orders",
  ],
  projects: ["projects", "tasks", "kanban", "board", "project management", "team", "todo"],
  "analytics-dashboard": ["analytics", "dashboard", "kpi", "metrics", "charts", "reporting", "csv"],
  tracker: ["tracker", "habit", "habits", "goals", "streak", "log", "fitness"],
  "ai-agents": [
    "ai",
    "agent",
    "agents",
    "assistant",
    "chatbot",
    "support agent",
    "knowledge base",
    "rag",
    "classification",
    "summarise",
    "summarize",
    "extraction",
    "inference",
    "llm",
  ],
};

const human = (id: string) =>
  id
    .split("-")
    .map(
      (w) =>
        ({ ai: "AI", saas: "SaaS", crud: "CRUD" })[w] ?? w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");

const yaml = <T>(file: string): T | null =>
  existsSync(file) ? (parse(readFileSync(file, "utf8")) as T) : null;

interface RawCriterion {
  id?: unknown;
  criterion?: unknown;
  advertises?: unknown;
  label?: unknown;
  tests?: unknown;
  generated?: unknown;
  when?: unknown;
  same?: unknown;
}

/** A canonical criterion with its proof: its own linked tests, or those of the criterion it is the `same` as. */
interface Criterion {
  id: string;
  label: string;
  when: string | null;
  same: string | null;
  proof: string[];
}

/**
 * The readable label of an advertised function: `label` when the criterion declares one (catalogue wording that is a
 * fragment of a sentence), else its `advertises` words without a leading article, first letter capitalised.
 */
export function functionLabel(c: { advertises?: unknown; label?: unknown }): string {
  const text =
    typeof c.label === "string" && c.label.trim()
      ? c.label.trim()
      : String(c.advertises ?? "")
          .trim()
          .replace(/^(?:a|an|the)\s+/i, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function readCriteria(file: string): Criterion[] {
  const raw = yaml<RawCriterion[]>(file);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => typeof r?.id === "string" && typeof r.advertises === "string")
    .map((r) => ({
      id: String(r.id),
      label: functionLabel(r),
      when: typeof r.when === "string" ? r.when : null,
      same: typeof r.same === "string" ? r.same : null,
      proof: [
        ...(Array.isArray(r.tests) ? r.tests.map(String) : []),
        ...(typeof r.generated === "string" ? [`generated: ${r.generated}`] : []),
      ],
    }));
}

/** Criteria grouped into functions by label, in declaration order; a `same` criterion takes its target's proof. */
function functionsOf(criteria: Criterion[], all: Map<string, Criterion>): FunctionSource[] {
  const out = new Map<string, FunctionSource>();
  for (const c of criteria) {
    const proof = c.same ? (all.get(c.same)?.proof ?? []) : c.proof;
    const f = out.get(c.label) ?? { label: c.label, criteria: [], proof: [] };
    f.criteria.push(c.id);
    f.proof.push(...proof.filter((p) => !f.proof.includes(p)));
    out.set(c.label, f);
  }
  return [...out.values()];
}

interface Manifest {
  status?: string;
  capability?: { use_cases?: string[] };
}
interface Guide {
  name?: string;
  tagline?: string;
}

/** Approved catalogue components (component.yaml `status: approved`). */
function approvedComponents(componentsDir: string): string[] {
  return readdirSync(componentsDir)
    .filter((d) => yaml<Manifest>(join(componentsDir, d, "component.yaml"))?.status === "approved")
    .sort();
}

const isAi = (requiredComponents: string[]) =>
  requiredComponents.some((c) => c.startsWith("ai.orchestrator."));

/**
 * Criteria that hold in this area: `when: ai` ones only where the app has the AI orchestrator (the AI booking tools
 * are not a function of a bookings site without AI).
 */
const holds = (ai: boolean) => (c: Criterion) => c.when !== "ai" || ai;

export function readUseCases(recipesDir: string): UseCaseSource[] {
  const componentsDir = join(recipesDir, "..", "components");
  const approved = approvedComponents(componentsDir);
  const criteriaOf = new Map<string, Criterion[]>();
  const criteria = (dir: string, id: string) => {
    if (!criteriaOf.has(id)) criteriaOf.set(id, readCriteria(join(dir, id, "criteria.yaml")));
    return criteriaOf.get(id) ?? [];
  };
  const recipes = readdirSync(recipesDir)
    .filter((d) => existsSync(join(recipesDir, d, "recipe.yaml")))
    .sort();
  for (const r of recipes) criteria(recipesDir, r);
  for (const c of approved) criteria(componentsDir, c);
  const all = new Map([...criteriaOf.values()].flat().map((c) => [c.id, c]));
  // Functional components: approved, with canonical criteria (functions proved by tests), and the use cases they extend.
  const functional = approved
    .filter((id) => criteria(componentsDir, id).length > 0)
    .map((id) => ({
      id,
      useCases:
        yaml<Manifest>(join(componentsDir, id, "component.yaml"))?.capability?.use_cases ?? [],
      guide: yaml<Guide>(join(componentsDir, id, "guide.yaml")) ?? {},
    }));

  return recipes.map((id) => {
    const r = yaml<{
      title?: string;
      tagline?: string;
      description?: string;
      extends?: string;
      defaultCapabilities?: string[];
      requiredComponents?: Record<string, string>;
      nav?: { label: string }[];
    }>(join(recipesDir, id, "recipe.yaml"))!;
    const requiredComponents = Object.values(r.requiredComponents ?? {});
    const ai = isAi(requiredComponents);
    // Product surfaces never name third-party engines: ADR references are internal.
    const description = (r.description ?? "").replace(/\s*\(ADR-\d+\)/g, "").trim();
    return {
      id,
      name: r.title ?? human(id),
      description,
      tagline: r.tagline ?? "",
      extends: r.extends ?? null,
      capabilities: r.defaultCapabilities ?? [],
      requiredComponents,
      sections: (r.nav ?? []).map((n) => n.label),
      keywords: KEYWORDS[id] ?? [],
      // The area's verified functions: its own canonical criteria and those of the components it always installs.
      functions: functionsOf(
        [
          ...criteria(recipesDir, id),
          ...requiredComponents.flatMap((c) => criteria(componentsDir, c)),
        ].filter(holds(ai)),
        all,
      ),
      addOns: functional
        .filter((c) => c.useCases.includes(id) && !requiredComponents.includes(c.id))
        .map((c) => {
          if (!c.guide.name || !c.guide.tagline)
            throw new Error(
              `${c.id}: guide.yaml needs "name" and "tagline" (it is shown as an add-on of ${id}, ADR-0076)`,
            );
          return {
            id: c.id,
            name: c.guide.name,
            tagline: c.guide.tagline,
            functions: functionsOf(criteria(componentsDir, c.id).filter(holds(ai)), all),
          };
        }),
    };
  });
}

/**
 * Catalogue totals, computed (never written by hand): approved components, complete use cases, and functions proved by
 * tests — canonical criteria of recipes and approved components with their own linked tests (a `same` criterion
 * reuses another's proof and is not counted twice).
 */
export function readCatalogTotals(recipesDir: string): CatalogTotals {
  const componentsDir = join(recipesDir, "..", "components");
  const approved = approvedComponents(componentsDir);
  const recipes = readdirSync(recipesDir).filter((d) =>
    existsSync(join(recipesDir, d, "recipe.yaml")),
  );
  const criteria = [
    ...recipes.flatMap((r) => readCriteria(join(recipesDir, r, "criteria.yaml"))),
    ...approved.flatMap((c) => readCriteria(join(componentsDir, c, "criteria.yaml"))),
  ];
  return {
    components: approved.length,
    useCases: recipes.length,
    functions: new Set(criteria.filter((c) => !c.same && c.proof.length > 0).map((c) => c.id)).size,
  };
}

/** What the web app ships: labels only (the proof stays in the catalogue and its CI checks). */
const shipped = (u: UseCaseSource): UseCase => ({
  ...u,
  functions: u.functions.map((f) => f.label),
  addOns: u.addOns.map((a) => ({ ...a, functions: a.functions.map((f) => f.label) })),
});

export function renderUseCases(list: UseCaseSource[], totals: CatalogTotals): string {
  return `// turbineh:generated — pnpm --filter @turbineh/engine gen (from catalog/recipes and catalog/components). Do not edit by hand.
import type { CatalogTotals, UseCase } from "./types.js";

export const USE_CASES: UseCase[] = ${JSON.stringify(list.map(shipped), null, 2)};

export const CATALOG_TOTALS: CatalogTotals = ${JSON.stringify(totals, null, 2)};
`;
}

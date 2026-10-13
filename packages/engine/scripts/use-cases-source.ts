import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface UseCaseSource {
  id: string;
  name: string;
  description: string;
  extends: string | null;
  capabilities: string[];
  requiredComponents: string[];
  sections: string[];
  keywords: string[];
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
    .map((w) => (w === "ai" ? "AI" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

export function readUseCases(recipesDir: string): UseCaseSource[] {
  return readdirSync(recipesDir)
    .filter((d) => existsSync(join(recipesDir, d, "recipe.yaml")))
    .sort()
    .map((id) => {
      const r = parse(readFileSync(join(recipesDir, id, "recipe.yaml"), "utf8")) as {
        description?: string;
        extends?: string;
        defaultCapabilities?: string[];
        requiredComponents?: Record<string, string>;
        nav?: { label: string }[];
      };
      return {
        id,
        name: human(id),
        // Product surfaces never name third-party engines: ADR references are internal.
        description: (r.description ?? "").replace(/\s*\(ADR-\d+\)/g, "").trim(),
        extends: r.extends ?? null,
        capabilities: r.defaultCapabilities ?? [],
        requiredComponents: Object.values(r.requiredComponents ?? {}),
        sections: (r.nav ?? []).map((n) => n.label),
        keywords: KEYWORDS[id] ?? [],
      };
    });
}

export function renderUseCases(list: UseCaseSource[]): string {
  return `// turbineh:generated — pnpm --filter @turbineh/engine gen (from catalog/recipes). Do not edit by hand.
import type { UseCase } from "./types.js";

export const USE_CASES: UseCase[] = ${JSON.stringify(list, null, 2)};
`;
}

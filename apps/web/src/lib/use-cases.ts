// Data only (no Node modules): this file is imported by client components.
import { USE_CASES as CATALOG_USE_CASES } from "@turbineh/engine/use-cases";
import type { CapabilitySummary, Requirement } from "@turbineh/shared";

/**
 * Use cases for Discover by need and the wizard's fallback plan; the engine search returns the same shape (and real
 * component counts). No figures here that do not come from bench/: `components: 0` means "not counted here".
 */
const base = ["Next.js 16", "TypeScript", "PostgreSQL"];
const env = (name: string, why: string): Requirement => ({
  kind: "env",
  name,
  why,
  satisfied: false,
});
const db = env("DATABASE_URL", "PostgreSQL connection for your data");
const auth = env("BETTER_AUTH_SECRET", "Signs sessions (generated for you when we deploy)");

export interface UseCase extends CapabilitySummary {
  keywords: string[];
  /** The area's verified functions (catalogue criteria linked to tests, ADR-0076). */
  functions: string[];
}

/** What a flow needs before it runs in a project (never values). Everything else comes from the catalogue. */
const stripe = [
  env("STRIPE_SECRET_KEY", "Card payments"),
  env("STRIPE_WEBHOOK_SECRET", "Confirms paid orders"),
];
const ai = env(
  "TURBINEH_AI_TOKEN",
  "AI calls through the TurbineH gateway — or leave it empty and use your own provider (AI_BASE_URL, AI_API_KEY, AI_MODEL)",
);
const EXTRA_REQUIREMENTS: Record<string, Requirement[]> = { "ai-agents": [ai], storefront: stripe };

/**
 * Complete use cases (catalog/recipes, through the engine's generated index): name, one-line summary, verified functions,
 * keywords and the guarded example (CI: apps/worker/src/example-prompts.test.ts) come from the catalogue, so Discover
 * never promises what no test proves (ADR-0076). AI first: an AI agent/assistant need is an AI flow.
 */
export const USE_CASES: UseCase[] = [...CATALOG_USE_CASES]
  .sort((a, b) => Number(b.id === "ai-agents") - Number(a.id === "ai-agents"))
  .map((u) => ({
    id: u.id,
    kind: "use_case",
    name: u.name,
    summary: u.tagline,
    components: 0,
    stacks: base,
    requirements: [db, auth, ...(EXTRA_REQUIREMENTS[u.id] ?? [])],
    // The use case's catalogue example (the engine's `summarizeUseCase(u).example`).
    example: u.description,
    keywords: u.keywords,
    functions: u.functions,
  }));

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 1);

/** Simple relevance: words of the need found in the use case keywords, name and summary. */
export function matchUseCases(q: string): UseCase[] {
  const ws = words(q);
  if (ws.length === 0) return USE_CASES;
  // An AI agent/assistant need is an AI flow first: the domain (bookings, shop…) becomes its tools and data.
  const wantsAi = ws.some((w) =>
    ["ai", "agent", "agents", "assistant", "chatbot", "llm"].includes(w),
  );
  return USE_CASES.map((u) => {
    const hay =
      `${u.keywords.join(" ")} ${u.name} ${u.summary} ${u.functions.join(" ")}`.toLowerCase();
    const score =
      ws.filter((w) => hay.includes(w)).length + (wantsAi && u.id === "ai-agents" ? 10 : 0);
    return { u, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.u);
}

import type { CapabilitySummary, Requirement } from "@turbineh/shared";
import type { CatalogEntry, UseCase } from "./types.js";
import { USE_CASES } from "./use-cases.generated.js";

const STOP = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "to",
  "and",
  "or",
  "with",
  "my",
  "our",
  "in",
  "on",
  "that",
  "this",
  "i",
  "we",
  "need",
  "want",
  "build",
  "make",
  "create",
  "app",
  "application",
  "system",
  "some",
  "simple",
  "un",
  "una",
  "de",
  "para",
  "con",
  "el",
  "la",
  "los",
  "las",
  "y",
  "que",
  "mi",
  "nuestro",
]);

/** Lower-case word stems ("bookings" → "booking", "agentes" → "agente"). */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) =>
      w.length > 4 && w.endsWith("es")
        ? w.slice(0, -2)
        : w.length > 3 && w.endsWith("s")
          ? w.slice(0, -1)
          : w,
    );
}

function score(query: string[], fields: { text: string; weight: number }[]): number {
  if (query.length === 0) return 0;
  let s = 0;
  for (const f of fields) {
    const t = new Set(terms(f.text));
    for (const q of query) if (t.has(q)) s += f.weight;
  }
  return s / query.length;
}

/** Environment variables a use case or component needs from the client (never values). */
export function requirementsFor(capabilities: string[]): Requirement[] {
  const req: Requirement[] = [
    {
      kind: "service",
      name: "PostgreSQL",
      why: "Data, sessions and audit trail",
      satisfied: false,
    },
  ];
  const caps = new Set(capabilities);
  if (caps.has("payments.checkout") || caps.has("payments.subscriptions"))
    req.push({
      kind: "env",
      name: "STRIPE_SECRET_KEY",
      why: "Charge customers with your Stripe account",
      satisfied: false,
    });
  if (caps.has("email.transactional"))
    req.push({
      kind: "env",
      name: "RESEND_API_KEY",
      why: "Send emails (logged to the console until set)",
      satisfied: false,
    });
  if ([...caps].some((c) => c.startsWith("ai.")))
    req.push({
      kind: "env",
      name: "TURBINEH_AI_TOKEN",
      why: "AI calls through the TurbineH orchestrator (issued per app; no model keys needed)",
      satisfied: false,
    });
  return req;
}

const COMPONENT_COUNT_FALLBACK = 0;

export function summarizeUseCase(
  u: UseCase,
  componentCount = COMPONENT_COUNT_FALLBACK,
): CapabilitySummary {
  return {
    id: u.id,
    kind: "use_case",
    name: u.name,
    summary: u.description,
    components: componentCount,
    stacks: ["typescript", "nextjs@16", "postgres"],
    requirements: requirementsFor([
      ...u.capabilities,
      ...(u.id === "ai-agents" ? ["ai.orchestrator"] : []),
    ]),
    example: `A runnable ${u.name.toLowerCase()} app with sample data${u.sections.length ? ` (${u.sections.join(", ")})` : ""}, verified in the TurbineH sandbox.`,
  };
}

export function componentSummary(c: CatalogEntry): CapabilitySummary {
  return {
    id: c.id,
    kind: "component",
    name: c.id,
    summary: c.does,
    components: 1,
    stacks: ["typescript"],
    requirements: requirementsFor(c.provides).filter((r) => r.kind !== "service"),
    example:
      c.docs?.example ||
      `Contract test and ${c.purl.startsWith("pkg:generic/turbineh") ? "TurbineH module" : "curated integration code"} for ${c.provides.join(", ")}.`,
    ...(c.docs
      ? {
          docs: {
            useWhen: c.docs.useWhen,
            avoidWhen: c.docs.avoidWhen,
            tradeoffs: c.docs.tradeoffs,
            limits: c.docs.limits,
            keywords: c.docs.keywords,
            testedGuarantees: c.docs.guarantees,
          },
        }
      : {}),
  };
}

/**
 * Search by need (PLAN §16 "Descubrir"): complete use cases first when they match, then the components that cover
 * the need. Deterministic keyword scoring over names, descriptions, capabilities and curated synonyms.
 */
export function searchCapabilities(
  query: string,
  components: CatalogEntry[],
  opts: { limit?: number; useCases?: UseCase[] } = {},
): (CapabilitySummary & { score: number })[] {
  const q = terms(query);
  const useCases = opts.useCases ?? USE_CASES;
  const byUseCase = (id: string) => components.filter((c) => c.useCases?.includes(id)).length;
  const uc = useCases
    .map((u) => ({
      ...summarizeUseCase(u, byUseCase(u.id)),
      score: score(q, [
        { text: u.keywords.join(" "), weight: 3 },
        { text: u.name, weight: 2 },
        { text: u.description, weight: 1 },
      ]),
    }))
    .filter((x) => q.length === 0 || x.score > 0);
  const comp = components
    .map((c) => ({
      ...componentSummary(c),
      score: score(q, [
        { text: c.provides.join(" ").replace(/[.-]/g, " "), weight: 2 },
        { text: c.does, weight: 1 },
        { text: c.id.replace(/[.-]/g, " "), weight: 1 },
        // Documentation (docs.yaml): keywords and synonyms, use cases and when to use it.
        { text: (c.docs?.keywords ?? []).join(" ").replace(/[.-]/g, " "), weight: 3 },
        { text: [...(c.docs?.useCases ?? []), ...(c.docs?.useWhen ?? [])].join(" "), weight: 1 },
      ]),
    }))
    .filter((x) => q.length > 0 && x.score > 0);
  return [...uc.sort((a, b) => b.score - a.score), ...comp.sort((a, b) => b.score - a.score)]
    .sort((a, b) => b.score - a.score || (a.kind === "use_case" ? -1 : 1))
    .slice(0, opts.limit ?? 20);
}

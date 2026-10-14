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
        // Documentation (guide.yaml): keywords and synonyms, use cases and when to use it.
        { text: (c.docs?.keywords ?? []).join(" ").replace(/[.-]/g, " "), weight: 3 },
        { text: [...(c.docs?.useCases ?? []), ...(c.docs?.useWhen ?? [])].join(" "), weight: 1 },
      ]),
    }))
    .filter((x) => q.length > 0 && x.score > 0);
  return [...uc.sort((a, b) => b.score - a.score), ...comp.sort((a, b) => b.score - a.score)]
    .sort((a, b) => b.score - a.score || (a.kind === "use_case" ? -1 : 1))
    .slice(0, opts.limit ?? 20);
}

const WORD_STOP = new Set([
  ...STOP,
  "small",
  "based",
  "my",
  "your",
  "their",
  "it",
  "is",
  "are",
  "be",
]);

/**
 * One stem per word, the same for every form: "parse", "parses", "parsing" → "pars"; "retries", "retry" → "retry";
 * "formatting" → "format"; "dates", "date" → "dat". Only for matching a need against component descriptions.
 */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 4 && /([bdfgklmnprt])\1$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !WORD_STOP.has(w))
      .map(stem),
  );
}

/** One component chosen for a need, with the words of the need it covers. */
export interface NeedMatch {
  entry: CatalogEntry;
  covers: string[];
  score: number;
}

/**
 * Components that cover a short need (component-only plans for an existing project, ADR-0051). Deterministic, never a
 * model:
 *  1. each word of the need weighs by how rare it is in the catalog (inverse document frequency), so "http", "retry"
 *     or "qr" decide and "client" or "parse" barely count; a word in the component's capability name (id, provides)
 *     counts double, one only in its description or keywords counts once;
 *  2. the best component is taken first; another one only when it names, in its capability, a word of the need that
 *     the chosen ones do not cover, and the uncovered words it covers are worth at least `minShare` of the best
 *     component's score — a second capability of the need, never a component that merely shares a common word;
 *  3. at most `limit` components. Declared dependencies (`requires`) are added by the caller.
 */
export function componentsForNeed(
  need: string,
  entries: CatalogEntry[],
  opts: { limit?: number; minShare?: number } = {},
): NeedMatch[] {
  const q = [...stems(need)];
  if (q.length === 0 || entries.length === 0) return [];
  const docs = entries.map((e) => {
    const name = stems(`${e.id} ${e.provides.join(" ")}`.replace(/[.-]/g, " "));
    const text = stems(`${e.does} ${(e.docs?.keywords ?? []).join(" ")}`.replace(/[.-]/g, " "));
    return { entry: e, name, all: new Set([...name, ...text]) };
  });
  const idf = new Map(
    q.map((t) => {
      const df = docs.filter((d) => d.all.has(t)).length;
      return [t, df === 0 ? 0 : Math.log(1 + entries.length / df)] as const;
    }),
  );
  const scored = docs
    .map((d) => {
      const covers = q.filter((t) => d.all.has(t));
      const value = (ts: string[]) =>
        ts.reduce((a, t) => a + (idf.get(t) ?? 0) * (d.name.has(t) ? 2 : 1), 0);
      return { entry: d.entry, covers, score: value(covers), value, name: d.name };
    })
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.covers.length - a.covers.length ||
        a.entry.id.localeCompare(b.entry.id),
    );
  const best = scored[0];
  if (!best) return [];
  const picked = [best];
  const covered = new Set(best.covers);
  const minGain = (opts.minShare ?? 0.5) * best.score;
  while (picked.length < (opts.limit ?? 6)) {
    let next: (typeof scored)[number] | null = null;
    let nextGain = 0;
    for (const m of scored) {
      if (picked.includes(m)) continue;
      const fresh = m.covers.filter((t) => !covered.has(t));
      if (!fresh.some((t) => m.name.has(t))) continue;
      const gain = m.value(fresh);
      if (gain >= minGain && gain > nextGain) {
        next = m;
        nextGain = gain;
      }
    }
    if (!next) break;
    picked.push(next);
    next.covers.forEach((t) => covered.add(t));
  }
  return picked.map((m) => ({ entry: m.entry, covers: m.covers, score: m.score }));
}

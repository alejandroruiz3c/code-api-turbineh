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
      why: "AI calls: a TurbineH gateway token (issued per app), or your own OpenAI-compatible provider instead (AI_BASE_URL, AI_API_KEY, AI_MODEL)",
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
    ...(c.docs?.example && c.docs.exampleCheck ? { exampleCheck: c.docs.exampleCheck } : {}),
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
 * Words people use for a need → the words the catalogue documents it with (stems, see `stem`). Query expansion only:
 * an expanded word counts at half weight, so a result that names the need itself always ranks first.
 */
const INTENT_SYNONYMS: Record<string, string[]> = {
  generat: ["creat"],
  mak: ["creat"],
  shop: ["store", "storefront", "commerce", "cart"],
  store: ["shop", "storefront"],
  card: ["checkout", "stripe"],
  payment: ["checkout", "stripe"],
  pay: ["checkout", "payment"],
  sign: ["auth", "session", "login"],
  login: ["auth", "session"],
  team: ["organization", "workspace", "member"],
  role: ["permission", "authz"],
  "two-factor": ["mfa", "otp", "totp", "2fa"],
  "2fa": ["mfa", "otp", "totp", "two-factor"],
  mfa: ["otp", "totp", "two-factor"],
  appointment: ["booking"],
  booking: ["appointment"],
  excel: ["xlsx", "spreadsheet"],
  spreadsheet: ["xlsx", "excel"],
  kpi: ["metric", "analytic"],
  chart: ["graph"],
  email: ["mail"],
  job: ["cron", "schedul", "queue"],
  background: ["queue", "job"],
  schedul: ["cron"],
  blog: ["post", "rss"],
  feed: ["rss"],
  billing: ["subscription"],
  subscription: ["billing", "recurr"],
  upload: ["file", "storage"],
  s3: ["object", "storage"],
  habit: ["tracker", "streak"],
  sanitiz: ["xss"],
  translat: ["translation", "i18n", "locale"],
  agent: ["assistant"],
  assistant: ["agent"],
  chatbot: ["assistant", "agent"],
  waitlist: ["signup"],
};

/** A searchable document: a complete use case or a component, its fields by weight. */
interface SearchDoc {
  /** Words of the name: id segments, provided capabilities, use-case name. Strongest signal. */
  name: Set<string>;
  /** Curated keywords and synonyms of the guide. */
  keywords: Set<string>;
  /** The capability description (manifest `does`, use-case description): used to rerank. */
  description: Set<string>;
  /** Use cases and "use when" sentences. */
  usage: Set<string>;
}

const FIELD_WEIGHT = {
  name: 3,
  keywords: 2,
  description: 1.5,
  usage: 1,
} as const;
const MAX_WEIGHT = 3;

/**
 * Discover relevance (ADR-0066, audit §5.3). Below MIN_SIMILARITY a result is not shown; below RELATIVE_CUT of the
 * best result's score it is not shown either (a long tail of one-common-word matches is noise, not a result). Both
 * thresholds and the weights are measured on bench/validation/discover-queries.json (precision@5 ≥ 0.8 in CI).
 */
export const MIN_SIMILARITY = 0.25;
export const RELATIVE_CUT = 0.3;
/** Weight of the rerank by capability description (share of the need's words the description itself names). */
const DESCRIPTION_RERANK = 0.8;

function searchDoc(fields: {
  name: string;
  keywords: string;
  description: string;
  usage: string;
}): SearchDoc {
  const clean = (t: string) => t.replace(/[._/]/g, " ");
  // What the capability does is the description outside parentheses; a parenthetical gives examples ("YAML (agent
  // and prompt configuration)" is about YAML, not agents) and counts like a use case.
  const asides = [...fields.description.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" ");
  return {
    name: stems(clean(fields.name)),
    keywords: stems(clean(fields.keywords)),
    description: stems(fields.description.replace(/\([^)]*\)/g, " ")),
    usage: stems(`${fields.usage} ${asides}`),
  };
}

/**
 * Scores a document for a need: every word of the need weighs by its rarity in the catalogue (inverse document
 * frequency) times the strongest field that contains it (an expanded synonym at half weight); the similarity is that
 * sum over the best possible (every word in the name), in [0, 1]. The rerank adds the idf-weighted share of the
 * need's words that the capability description names.
 */
function similarity(
  q: string[],
  doc: SearchDoc,
  idf: Map<string, number>,
): { sim: number; description: number; matched: number } {
  let got = 0;
  let max = 0;
  let desc = 0;
  let matched = 0;
  for (const t of q) {
    const w = idf.get(t) ?? 0;
    max += w * MAX_WEIGHT;
    const field = (word: string) =>
      doc.name.has(word)
        ? FIELD_WEIGHT.name
        : doc.keywords.has(word)
          ? FIELD_WEIGHT.keywords
          : doc.description.has(word)
            ? FIELD_WEIGHT.description
            : doc.usage.has(word)
              ? FIELD_WEIGHT.usage
              : 0;
    const direct = field(t);
    const expanded = Math.max(0, ...(INTENT_SYNONYMS[t] ?? []).map((x) => field(x) / 2));
    const best = Math.max(direct, expanded);
    if (best > 0) matched++;
    got += w * best;
    const inDesc =
      doc.description.has(t) || (INTENT_SYNONYMS[t] ?? []).some((x) => doc.description.has(x));
    if (inDesc) desc += w;
  }
  const total = q.reduce((a, t) => a + (idf.get(t) ?? 0), 0);
  return { sim: max ? got / max : 0, description: total ? desc / total : 0, matched };
}

/**
 * Search by need (PLAN §16 "Descubrir"): complete use cases and verified components ranked together by similarity to
 * the need, reranked by their capability description, with a minimum similarity and a cut relative to the best
 * result. Deterministic (no model): the same need always gives the same results.
 */
export function searchCapabilities(
  query: string,
  components: CatalogEntry[],
  opts: { limit?: number; useCases?: UseCase[] } = {},
): (CapabilitySummary & { score: number })[] {
  const useCases = opts.useCases ?? USE_CASES;
  const byUseCase = (id: string) => components.filter((c) => c.useCases?.includes(id)).length;
  const q = [...stems(query, SEARCH_STOP)];
  if (q.length === 0) {
    // No need typed: the complete use cases, as a starting point.
    return useCases.map((u) => ({ ...summarizeUseCase(u, byUseCase(u.id)), score: 0 }));
  }
  const docs = [
    ...useCases.map((u) => ({
      summary: () => summarizeUseCase(u, byUseCase(u.id)),
      doc: searchDoc({
        name: `${u.id} ${u.name}`,
        keywords: u.keywords.join(" "),
        description: u.description,
        usage: u.sections.join(" "),
      }),
    })),
    ...components.map((c) => ({
      summary: () => componentSummary(c),
      doc: searchDoc({
        name: `${c.id.split(".").slice(0, 2).join(" ")} ${c.provides.join(" ")}`,
        keywords: (c.docs?.keywords ?? []).join(" "),
        description: c.does,
        usage: [...(c.docs?.useCases ?? []), ...(c.docs?.useWhen ?? [])].join(" "),
      }),
    })),
  ];
  const all = (d: SearchDoc) => new Set([...d.name, ...d.keywords, ...d.description, ...d.usage]);
  const sets = docs.map((d) => all(d.doc));
  const idf = new Map(
    [...new Set([...q, ...q.flatMap((t) => INTENT_SYNONYMS[t] ?? [])])].map((t) => {
      const df = sets.filter((s) => s.has(t)).length;
      // A word no document has still counts in the denominator of the need (it is part of what was asked).
      return [t, Math.log(1 + docs.length / Math.max(df, 1))] as const;
    }),
  );
  const scored = docs
    .map((d) => {
      const s = similarity(q, d.doc, idf);
      return { d, sim: s.sim, score: s.sim + DESCRIPTION_RERANK * s.description * s.sim };
    })
    .filter((x) => x.sim >= MIN_SIMILARITY);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored
    .filter((x) => x.score >= RELATIVE_CUT * best)
    .map((x) => ({ ...x.d.summary(), score: Math.round(x.score * 1000) / 1000 }))
    .sort(
      (a, b) => b.score - a.score || (a.kind === "use_case" ? -1 : 1) || a.id.localeCompare(b.id),
    )
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

/** Function words of a search need that say nothing about the capability. */
const SEARCH_STOP = new Set([
  "into",
  "from",
  "by",
  "over",
  "about",
  "at",
  "as",
  "using",
  "via",
  "per",
  "every",
]);

function stems(text: string, extraStop?: ReadonlySet<string>): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !WORD_STOP.has(w) && !extraStop?.has(w))
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

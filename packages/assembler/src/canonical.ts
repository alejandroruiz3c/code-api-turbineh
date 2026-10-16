import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { proofVerdict, rolesIn, salientStems, statesRefusal } from "@turbineh/shared";
import { parse } from "yaml";
import { splitTestRef, testBlocks } from "./acceptance.js";
import { entityNames } from "./naming.js";
import { readRecipe, recipeChain } from "./recipes.js";

/**
 * Canonical acceptance criteria (ADR-0063). Every recipe (and every domain component a recipe relies on) declares, in
 * `criteria.yaml`, one canonical criterion per function its catalogue text advertises, each linked to the test(s) that
 * prove it. When a request's criterion maps to canonical criteria, the plan uses the canonical wording (the request's
 * own words are kept as `asked`), and the criterion is met exactly when its linked tests are in the package and the
 * gate passed: matching is a declared link, not a guess. Everything deterministic; residual criteria (no canonical)
 * keep the existing path (proof by test title, then the decider).
 *
 * A request criterion maps to a canonical criterion only when (1) every `says` pattern matches it, (2) every role it
 * names is one the canonical criterion serves, (3) a refusal it states is a refusal the canonical criterion states,
 * and (4) nothing of it is left over: each of its salient words is a word of the canonical criterion, of its linked
 * tests' titles, of its declared `terms` or of this app's declared aliases. A leftover word ("…and pays a deposit")
 * keeps the criterion out: it is not claimed by a function it does not fully describe.
 */
export interface CanonicalCriterion {
  /** Stable id, `<recipe or component>.<function>`, e.g. "bookings.public-booking". */
  id: string;
  /** The canonical wording; each linked test proves it (checked in CI with `proofVerdict`). */
  criterion: string;
  /** The words of the catalogue description (recipe or component) this criterion proves. */
  advertises: string;
  /** Case-insensitive patterns that must all match a request criterion for it to map here. */
  says: string[];
  /** Extra words requests use for this function (absorbed by the residual check). */
  terms: string[];
  /** Roles this function serves besides those its wording names (absorbed by the actor check). */
  actors: string[];
  /**
   * The domain's nouns, shared by every canonical criterion of the same file (`- vocabulary: …` entry): what the
   * function acts on (session, appointment, client…), never what it does.
   */
  vocabulary: string[];
  /** "file › title" of the tests that prove it (all must be in the package). */
  tests: string[];
  /**
   * Functions the assembler generates per entity (saas-crud's CRUD screens): the criterion has an `{entity}`
   * placeholder and links to the generated test of that entity whose title matches this pattern.
   */
  generated?: string;
  /** Only under this condition of the app (`open-sign-up`: anyone may create an account). */
  when?: string;
  /**
   * A function this recipe advertises that another canonical criterion of its chain already proves (e.g. the
   * internal tool's "search" is saas-crud's): counted by the catalogue audit, never matched on its own.
   */
  same?: string;
  /** Recipe or component id that declares it. */
  from: string;
}

/** A canonical criterion resolved for this app: concrete wording and test references. */
export interface ResolvedCanonical extends CanonicalCriterion {
  /** For generated functions: the entity it is about. */
  entity?: string;
  /** For generated functions: the entity's field names (words a request uses for its details). */
  fields?: string[];
}

/** An entity of the request: its name, and its fields when known. */
export type CanonicalEntity = string | { name: string; fields?: readonly { name: string }[] };

interface RawCanonical {
  id?: unknown;
  criterion?: unknown;
  advertises?: unknown;
  says?: unknown;
  terms?: unknown;
  actors?: unknown;
  tests?: unknown;
  generated?: unknown;
  when?: unknown;
  same?: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : [];

export function readCanonical(file: string, from: string): CanonicalCriterion[] {
  if (!existsSync(file)) return [];
  const raw = parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) return [];
  const vocabulary = (raw as { vocabulary?: unknown }[]).flatMap((r) =>
    r && typeof r === "object" && "vocabulary" in r ? strings(r.vocabulary) : [],
  );
  return (raw as RawCanonical[])
    .filter(
      (r) =>
        typeof r?.id === "string" &&
        (typeof r.criterion === "string" || typeof r.same === "string"),
    )
    .map((r) => ({
      id: String(r.id),
      criterion: typeof r.criterion === "string" ? r.criterion : "",
      advertises: typeof r.advertises === "string" ? r.advertises : "",
      says: strings(r.says),
      terms: strings(r.terms),
      actors: strings(r.actors),
      vocabulary,
      tests: Array.isArray(r.tests) ? r.tests.map(String) : [],
      ...(typeof r.generated === "string" ? { generated: r.generated } : {}),
      ...(typeof r.when === "string" ? { when: r.when } : {}),
      ...(typeof r.same === "string" ? { same: r.same } : {}),
      from,
    }));
}

/** Component ids a recipe chain always installs (requiredComponents), parent first. */
export function requiredComponentsOf(recipesDir: string, recipe: string): string[] {
  return [
    ...new Set(
      recipeChain(recipesDir, recipe).flatMap((m) => Object.values(m.requiredComponents ?? {})),
    ),
  ];
}

/**
 * The canonical criteria of a recipe chain and of components (the recipe's required ones plus `components`), in
 * declaration order. `components` are catalogue ids.
 */
export function canonicalCriteria(input: {
  recipesDir: string;
  recipe: string;
  components?: readonly string[];
}): CanonicalCriterion[] {
  const componentsDir = join(input.recipesDir, "..", "components");
  const chain = recipeChain(input.recipesDir, input.recipe);
  const ids = [
    ...new Set([
      ...requiredComponentsOf(input.recipesDir, input.recipe),
      ...(input.components ?? []),
    ]),
  ];
  const seen = new Set<string>();
  return [
    ...chain.flatMap((m) => readCanonical(join(input.recipesDir, m.id, "criteria.yaml"), m.id)),
    ...ids.flatMap((id) => readCanonical(join(componentsDir, id, "criteria.yaml"), id)),
  ].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/**
 * Resolves canonical criteria for this app: static ones whose every linked test exists (`source(file)` reads a test
 * file from the package, or from the catalogue sources before assembly); generated ones once per entity, linked to the
 * generated test whose title matches (`generatedTests(entity)` lists that entity's generated test titles, or null
 * when they are not known yet: at planning, generated functions are linked when the package is assembled).
 */
export function resolveCanonical(
  list: readonly CanonicalCriterion[],
  source: (file: string) => string | null,
  entities: readonly CanonicalEntity[] = [],
  generatedTests?: (entity: string) => { file: string; titles: string[] } | null,
  /** Conditions this app meets (`open-sign-up`); unknown at planning (null): conditional criteria are kept. */
  conditions: ReadonlySet<string> | null = null,
): ResolvedCanonical[] {
  const titles = new Map<string, string[] | null>();
  const titlesOf = (file: string) => {
    if (!titles.has(file)) {
      const src = source(file);
      titles.set(file, src === null ? null : testBlocks(src).map((b) => b.title));
    }
    return titles.get(file);
  };
  const present = (ref: string) => {
    const { file, title } = splitTestRef(ref);
    return titlesOf(file)?.includes(title) ?? false;
  };
  return list.flatMap((c): ResolvedCanonical[] => {
    if (c.same || !c.criterion) return [];
    if (c.when && conditions && !conditions.has(c.when)) return [];
    if (!c.generated) return c.tests.length > 0 && c.tests.every(present) ? [c] : [];
    const re = safeRegExp(c.generated);
    if (!re) return [];
    return entities.flatMap((e) => {
      const entity = typeof e === "string" ? e : e.name;
      const fields = typeof e === "string" ? [] : (e.fields ?? []).map((f) => f.name);
      const n = entityNames(entity);
      const label = n.labelSingular.toLowerCase();
      const plural = n.labelPlural.toLowerCase();
      const filled = c.criterion.replaceAll("{entity}", label).replaceAll("{entities}", plural);
      const criterion = filled.charAt(0).toUpperCase() + filled.slice(1);
      const id = `${c.id}:${entity}`;
      if (!generatedTests) return [{ ...c, id, criterion, entity, fields, tests: [] }];
      const g = generatedTests(entity);
      const title = g?.titles.find((t) => re.test(t));
      return g && title
        ? [{ ...c, id, criterion, entity, fields, tests: [`${g.file} › ${title}`] }]
        : [];
    });
  });
}

const safeRegExp = (re: string): RegExp | null => {
  try {
    return new RegExp(re, "i");
  } catch {
    return null;
  }
};

/** A declared alias of this app (ADR-0047/0049): the word a test uses and this app's words for it. */
export interface CanonicalAlias {
  term: string;
  means: string[];
}
/** App words: plain words (role names) or declared aliases. */
export type AliasInput = string | CanonicalAlias;
const aliasWords = (aliases: readonly AliasInput[]): string[] =>
  aliases.flatMap((a) => (typeof a === "string" ? [a] : a.means));
const escapeWord = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The request criterion with each declared alias's generic term next to this app's word ("artist staff member"). */
const withTerms = (derived: string, aliases: readonly AliasInput[]): string =>
  aliases.reduce<string>((text, a) => {
    if (typeof a === "string") return text;
    const hit = a.means.some(
      (m) => m.trim() && new RegExp(`\\b${escapeWord(m.trim())}s?\\b`, "i").test(derived),
    );
    return hit ? `${text} ${a.term}` : text;
  }, derived);

/** Words a canonical criterion absorbs: its wording, its tests' titles, its terms and actors, and app aliases. */
function absorbed(c: ResolvedCanonical, aliases: readonly string[]): Set<string> {
  // The domain's nouns are absorbed too.
  const titles = c.tests.map((t) => splitTestRef(t).title);
  const entityWords = c.entity
    ? [
        entityNames(c.entity).labelSingular,
        entityNames(c.entity).labelPlural,
        ...(c.fields ?? []).map((f) => f.replace(/([a-z])([A-Z])/g, "$1 $2")),
      ]
    : [];
  return salientStems(
    [
      c.criterion,
      c.advertises,
      ...titles,
      ...c.terms,
      ...c.actors,
      ...(c.vocabulary ?? []),
      ...entityWords,
      ...aliases,
    ].join("\n"),
  );
}

function servesActors(derived: string, c: ResolvedCanonical, aliases: readonly string[]): boolean {
  const serves = rolesIn(
    [c.criterion, ...c.actors, ...aliases, ...c.tests.map((t) => splitTestRef(t).title)].join(" "),
  );
  return [...rolesIn(derived)].every((r) => serves.has(r));
}

/**
 * "Only" restricts who may act ("only staff see bookings": a refusal of everyone else) or what is shown ("a list of only
 * the tasks assigned to them": no refusal). The second kind is not a refusal for the mapping.
 */
const scopeOnly = (text: string): string =>
  text.replace(
    /\bonly\b(?!\s+(?:the\s+|an?\s+)?(?:[a-z-]+\s+)?(?:owners?|admins?|administrators?|staff|managers?|members?|editors?|viewers?|users?|people|employees?|customers?|clients?|signed|logged|authenticated|authori[sz]ed)\b)/gi,
    "",
  );

function candidate(
  derived: string,
  c: ResolvedCanonical,
  aliases: readonly string[],
  saysText: string = derived,
): boolean {
  if (c.says.length === 0) return false;
  // `says` reads the criterion with each declared alias's term ("an artist" also says "staff member").
  if (!c.says.every((p) => safeRegExp(p)?.test(saysText) ?? false)) return false;
  if (c.entity) {
    const n = entityNames(c.entity);
    const named = new RegExp(
      `\\b(${[n.labelSingular, n.labelPlural].map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
      "i",
    );
    if (!named.test(derived)) return false;
  }
  if (statesRefusal(scopeOnly(derived)) && !statesRefusal(c.criterion)) return false;
  return servesActors(derived, c, aliases);
}

/** Narrative words of Given/When/Then requirements that carry nothing to check (residual check only). */
const NARRATIVE = salientStems(
  "try tries tried trying another other second first both someone anyone everyone able allowed allows let lets " +
    "ensure ensures make makes sure should must want wants need needs needed way ways unique specific both " +
    "whenever upon existing option options format formats either successful successfully properly correctly " +
    "valid particular desired respective respectively relevant own only become becomes occur occurs high quality " +
    "distinct within historical automatically automatic correct one two three four five several various multiple " +
    "given exists exist specified certain additional exactly during provided provide visually personalized " +
    "personalised immediately",
);

const leftover = (
  derived: string,
  cs: readonly ResolvedCanonical[],
  aliases: readonly string[],
): string[] => {
  const have = new Set(cs.flatMap((c) => [...absorbed(c, aliases)]));
  return [...salientStems(derived)].filter((s) => !have.has(s) && !NARRATIVE.has(s));
};

/** Phrasings that read like another function's words: "reserves a 30-minute block" is a slot, not a time-off block. */
const normalize = (text: string): string =>
  text.replace(/\b(\d+[- ]?(?:min|mins|minutes?|hours?|h))\s+(?:time\s+)?block\b/gi, "$1 slot");

/** How much of a canonical criterion's own wording the request criterion expresses (0–1). */
const closeness = (derived: string, c: ResolvedCanonical): number => {
  const want = salientStems(c.criterion);
  const have = salientStems(derived);
  return want.size === 0 ? 0 : [...want].filter((s) => have.has(s)).length / want.size;
};

/**
 * The canonical criteria a request criterion maps to: the candidate that alone absorbs it and whose wording it expresses
 * most (ties: all of them), else the candidates together when only together they absorb it (a criterion that states
 * two functions needs both), else none.
 */
export function mapToCanonical(
  asked: string,
  canon: readonly ResolvedCanonical[],
  input: readonly AliasInput[] = [],
  /** The request's own subject words (requestWords): absorbed, never actors, never functions. */
  context: readonly string[] = [],
): ResolvedCanonical[] {
  const exact = canon.find((c) => c.criterion.toLowerCase() === asked.trim().toLowerCase());
  if (exact) return [exact];
  const derived = normalize(asked);
  const aliases = aliasWords(input);
  const absorbedAlso = [...aliases, ...context];
  const saysText = withTerms(derived, input);
  const cands = canon.filter((c) => candidate(derived, c, aliases, saysText));
  if (cands.length === 0) return [];
  const alone = cands.filter((c) => leftover(derived, [c], absorbedAlso).length === 0);
  if (alone.length > 0) {
    // Several functions each describe it: the one(s) whose own wording it expresses most.
    const best = Math.max(...alone.map((c) => closeness(derived, c)));
    return alone.filter((c) => closeness(derived, c) === best);
  }
  // Only together: the fewest functions (at most two) that absorb it, the closest first — never every candidate.
  const ranked = [...cands].sort((a, b) => closeness(derived, b) - closeness(derived, a));
  const chosen: ResolvedCanonical[] = [];
  for (const c of ranked) {
    const before = leftover(derived, chosen, absorbedAlso).length;
    if (chosen.length > 0 && leftover(derived, [...chosen, c], absorbedAlso).length >= before)
      continue;
    chosen.push(c);
    if (leftover(derived, chosen, absorbedAlso).length === 0) break;
    if (chosen.length === 2) break;
  }
  return chosen.length > 0 && leftover(derived, chosen, absorbedAlso).length === 0 ? chosen : [];
}

export interface CanonicalizedCriteria {
  /** The criteria to build and measure: canonical wording where the request maps to it, the request's elsewhere. */
  criteria: string[];
  /** Canonical criterion text → the request's own criteria it replaces. */
  asked: Record<string, string[]>;
  /** Criterion text → canonical id, for every canonical criterion in `criteria`. */
  links: Record<string, string>;
}

/**
 * Replaces each request criterion that maps to canonical criteria with their canonical wording (deduplicated, in
 * order); a criterion that maps to none stays as the request wrote it. Idempotent.
 */
export function canonicalize(
  criteria: readonly string[],
  canon: readonly ResolvedCanonical[],
  aliases: readonly AliasInput[] = [],
  previous: Record<string, string[]> = {},
  context: readonly string[] = [],
): CanonicalizedCriteria {
  const out: string[] = [];
  const asked: Record<string, string[]> = {};
  const links: Record<string, string> = {};
  const push = (text: string) => {
    if (!out.includes(text)) out.push(text);
  };
  for (const c of criteria) {
    const mapped = mapToCanonical(c, canon, aliases, context);
    if (mapped.length === 0) {
      push(c);
      continue;
    }
    for (const m of mapped) {
      push(m.criterion);
      links[m.criterion] = m.id;
      const from = [...(previous[c] ?? []), ...(m.criterion === c ? [] : [c])];
      if (from.length) asked[m.criterion] = [...new Set([...(asked[m.criterion] ?? []), ...from])];
    }
  }
  for (const [k, v] of Object.entries(previous))
    if (out.includes(k)) asked[k] = [...new Set([...v, ...(asked[k] ?? [])])];
  return { criteria: out, asked, links };
}

/**
 * The recipe's catalogue text split into the functions it advertises (top-level commas, dashes, semicolons). A first
 * part followed by a dash is the product's name ("Online booking site — …"), not a function.
 */
export function advertisedFunctions(description: string): string[] {
  const parts: string[] = [];
  let headline = false;
  let depth = 0;
  let cur = "";
  const text = description.replace(/\s*\(ADR-\d+\)\s*$/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    const dash = text.startsWith(" — ", i);
    if (depth === 0 && (ch === "," || ch === ";" || dash)) {
      if (dash && parts.length === 0) headline = true;
      parts.push(cur);
      cur = "";
      if (dash) i += 2;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts
    .slice(headline ? 1 : 0)
    .map((p) => p.trim().replace(/^and\s+/i, ""))
    .filter((p) => p.length > 0);
}

/** Catalogue audit of one recipe (CI): what it advertises without a canonical criterion, and broken links. */
export function auditRecipe(
  recipesDir: string,
  recipe: string,
): {
  description: string;
  canonical: CanonicalCriterion[];
  unclaimed: string[];
  problems: string[];
} {
  const meta = readRecipe(recipesDir, recipe);
  const componentsDir = join(recipesDir, "..", "components");
  const required = requiredComponentsOf(recipesDir, recipe);
  const chain = recipeChain(recipesDir, recipe);
  const own = [
    ...readCanonical(join(recipesDir, recipe, "criteria.yaml"), recipe),
    ...required.flatMap((id) => readCanonical(join(componentsDir, id, "criteria.yaml"), id)),
  ];
  const all = canonicalCriteria({ recipesDir, recipe });
  const problems: string[] = [];
  const description = meta.description.replace(/\s*\(ADR-\d+\)\s*$/, "");
  const lower = description.toLowerCase();
  // Tests are looked up where the package takes them from: the recipe chain's templates and the required
  // components' files (files-ai only when the recipe includes AI).
  const ai = required.some((id) => id.startsWith("ai.orchestrator"));
  const dirs = [
    ...[...chain].reverse().map((m) => join(recipesDir, m.id, "template")),
    ...required.flatMap((id) => [
      join(componentsDir, id, "files"),
      ...(ai ? [join(componentsDir, id, "files-ai")] : []),
    ]),
  ];
  const source = (file: string) => {
    for (const d of dirs) if (existsSync(join(d, file))) return readFileSync(join(d, file), "utf8");
    return null;
  };
  const policy = source("src/lib/sign-up-policy.ts");
  const conditions = new Set([
    ...(ai ? ["ai"] : []),
    ...(policy && /SIGN_UP_POLICY[^=]*=\s*"open"/.test(policy) ? ["open-sign-up"] : []),
  ]);
  for (const c of own) {
    // A criterion for another kind of app (e.g. the booking assistant in AI apps) is audited where it applies.
    if (c.when && !conditions.has(c.when)) continue;
    if (c.same && !all.some((o) => o.id === c.same && !o.same))
      problems.push(`${c.id}: "same: ${c.same}" is not a canonical criterion of this recipe chain`);
    if (!c.advertises) problems.push(`${c.id}: no "advertises"`);
    else if (!lower.includes(c.advertises.toLowerCase()) && c.from === recipe)
      problems.push(`${c.id}: advertises "${c.advertises}", not in the catalogue text`);
    for (const p of c.says)
      if (!safeRegExp(p)) problems.push(`${c.id}: invalid "says" pattern ${p}`);
    if (c.generated || c.same) continue;
    if (c.tests.length === 0) problems.push(`${c.id}: no linked test`);
    const reasons: string[] = [];
    let proven = false;
    for (const t of c.tests) {
      const { file, title } = splitTestRef(t);
      const src = source(file);
      const block = src === null ? undefined : testBlocks(src).find((b) => b.title === title);
      if (src === null) problems.push(`${c.id}: test file ${file} is not in the package`);
      else if (!block) problems.push(`${c.id}: no test titled "${title}" in ${file}`);
      else {
        const v = proofVerdict(c.criterion, block);
        if (v.proven) proven = true;
        else reasons.push(v.reason);
      }
    }
    // The canonical wording says only what a linked test proves (precision first, ADR-0039).
    if (c.tests.length > 0 && !proven && reasons.length > 0)
      problems.push(`${c.id}: no linked test proves the canonical wording (${reasons.join("; ")})`);
  }
  const resolved = resolveCanonical(all, source, [], undefined, conditions);
  for (const c of resolved.filter((r) => own.some((o) => o.id === r.id))) {
    if (!mapToCanonical(c.criterion, resolved).some((m) => m.id === c.id))
      problems.push(`${c.id}: its own wording does not map to it`);
  }
  // Every function the catalogue text names is claimed by a canonical criterion of the recipe or its components.
  const claims = all.filter((c) => c.advertises).map((c) => c.advertises.toLowerCase());
  const unclaimed = advertisedFunctions(description).filter(
    (f) => !claims.some((a) => f.toLowerCase().includes(a)),
  );
  return { description, canonical: own, unclaimed, problems };
}

/** Where a package takes its test files from, before assembly: the recipe chain's templates and the components. */
function catalogSource(recipesDir: string, recipe: string, components: readonly string[]) {
  const componentsDir = join(recipesDir, "..", "components");
  const ai = components.some((id) => id.startsWith("ai.orchestrator"));
  const dirs = [
    ...[...recipeChain(recipesDir, recipe)]
      .reverse()
      .map((m) => join(recipesDir, m.id, "template")),
    ...components.flatMap((id) => [
      join(componentsDir, id, "files"),
      ...(ai ? [join(componentsDir, id, "files-ai")] : []),
    ]),
  ];
  return (file: string): string | null => {
    for (const d of dirs) if (existsSync(join(d, file))) return readFileSync(join(d, file), "utf8");
    return null;
  };
}

/**
 * Canonical criteria a plan can use (ADR-0063): the recipe chain's and its components' (required ones plus
 * `components`) whose tests the package will ship, and the generated CRUD functions of the request's entities (their
 * tests are generated at assembly, so they are linked then).
 */
export function canonicalForPlan(input: {
  recipesDir: string;
  recipe: string;
  components?: readonly string[];
  entities?: readonly CanonicalEntity[];
}): ResolvedCanonical[] {
  const components = [
    ...new Set([
      ...requiredComponentsOf(input.recipesDir, input.recipe),
      ...(input.components ?? []),
    ]),
  ];
  return resolveCanonical(
    canonicalCriteria({ recipesDir: input.recipesDir, recipe: input.recipe, components }),
    catalogSource(input.recipesDir, input.recipe, components),
    input.entities ?? [],
  );
}

/** Words that name a capability or an external platform: a request word like these is never absorbed as context. */
const FEATURE_WORD =
  /^(sync|publish|post|integrat|import|export|notif|remind|sms|text|whatsapp|telegram|slack|discord|instagram|facebook|linkedin|twitter|tiktok|youtube|google|outlook|calendar|hubspot|salesforce|shopify|quickbooks|xero|mailchimp|zendesk|stripe|paypal|pay|charge|subscri|invoice|ai|chat|bot|assistant|email|mail|report|analytic|api|webhook|map|gps|video|stream|voice|call|phone|sign|login|password|translat|recommend|review|rating|loyalty|gift|refund|deliver|track|auction|bid)/i;

/**
 * The request's subject words (its app name and summary: "ceramics", "mug", "studio"), absorbed by the residual check
 * so a criterion about "a mug" can map to the shop's variants. Words that name a capability or a platform are left out.
 */
export const requestWords = (...texts: readonly (string | undefined)[]): string[] => [
  ...new Set(
    texts
      .join(" ")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && !FEATURE_WORD.test(w)),
  ),
];

/** Words of the request's own roles ("front_desk" → "front", "desk"), absorbed as actors of the app. */
export const roleWords = (roles: readonly string[] = []): string[] =>
  roles.flatMap((r) => r.split(/[_\s-]+/)).filter((w) => w.length > 2);

/** Every declared alias in the package (.turbineh/aliases.json): "customer" → "patient", "staff member" → "artist"… */
export function packageAliases(outDir: string): CanonicalAlias[] {
  const p = join(outDir, ".turbineh/aliases.json");
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8")) as {
      aliases?: { term?: string; means?: string[] }[];
    }[];
    return list.flatMap((r) =>
      (r.aliases ?? []).flatMap((a) =>
        typeof a.term === "string" && Array.isArray(a.means) && a.means.length
          ? [{ term: a.term, means: a.means.map(String) }]
          : [],
      ),
    );
  } catch {
    return [];
  }
}

/** Conditions of an assembled app the canonical criteria may depend on. */
export function packageConditions(outDir: string): Set<string> {
  const p = join(outDir, "src/lib/sign-up-policy.ts");
  const open = existsSync(p) && /SIGN_UP_POLICY[^=]*=\s*"open"/.test(readFileSync(p, "utf8"));
  // AI apps ship the TurbineH orchestrator's agent runtime.
  const ai = existsSync(join(outDir, "src/lib/ai/agent.ts"));
  return new Set([...(open ? ["open-sign-up"] : []), ...(ai ? ["ai"] : [])]);
}

/** A criterion linked to canonical criteria in an assembled package: their ids and the tests that prove them. */
export interface CriterionLink {
  canonical: string[];
  tests: string[];
}

/**
 * Links each criterion to canonical criteria in an assembled package (ADR-0063): the tests are read from the package
 * (a test that is not there links nothing), generated CRUD tests from each entity's generated spec, and this app's
 * aliases are absorbed. A criterion is linked only when every canonical criterion it maps to is in the package.
 */
export function linkCriteria(
  outDir: string,
  criteria: readonly string[],
  input: {
    recipesDir: string;
    recipe: string;
    components: readonly string[];
    entities: readonly CanonicalEntity[];
    roles?: readonly string[];
    /** The request's app name and summary (requestWords). */
    about?: readonly string[];
  },
): Map<string, CriterionLink> {
  const source = (file: string) =>
    existsSync(join(outDir, file)) ? readFileSync(join(outDir, file), "utf8") : null;
  const canon = resolveCanonical(
    canonicalCriteria(input),
    source,
    input.entities,
    (entity) => {
      const file = `tests/e2e/${entityNames(entity).slug}.spec.ts`;
      const src = source(file);
      return src === null ? null : { file, titles: testBlocks(src).map((b) => b.title) };
    },
    packageConditions(outDir),
  );
  const aliases: AliasInput[] = [...packageAliases(outDir), ...roleWords(input.roles)];
  const links = new Map<string, CriterionLink>();
  for (const c of criteria) {
    const mapped = mapToCanonical(c, canon, aliases, requestWords(...(input.about ?? [])));
    if (mapped.length === 0) continue;
    links.set(c, {
      canonical: mapped.map((m) => m.id),
      tests: [...new Set(mapped.flatMap((m) => m.tests))],
    });
  }
  return links;
}

/** Why a request criterion maps or not to each canonical criterion (diagnostics for catalogue authors and CI). */
export function explainCanonical(
  derived: string,
  canon: readonly ResolvedCanonical[],
  input: readonly AliasInput[] = [],
): { id: string; says: boolean; candidate: boolean; leftover: string[] }[] {
  const aliases = aliasWords(input);
  const saysText = withTerms(derived, input);
  return canon.map((c) => ({
    id: c.id,
    says: c.says.every((p) => safeRegExp(p)?.test(saysText) ?? false),
    candidate: candidate(derived, c, aliases, saysText),
    leftover: leftover(derived, [c], aliases),
  }));
}

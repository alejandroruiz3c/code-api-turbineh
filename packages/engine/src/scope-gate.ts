import type { Decider } from "@turbineh/decider";
import type { PlanScope, ScopeRequirement } from "@turbineh/shared";

/**
 * Scope gate (ADR-0052, owner rule): TurbineH only operates requests whose use case it covers — a covered recipe, or
 * catalogue components the request maps to (inferred or explicitly chosen). Everything a component was verified to do
 * stays true only inside that scope, so a request we do not cover is refused before anything is generated, never
 * built on "the closest template" (ADR-0050 §4, superseded).
 *
 * The gate reads the request's atomic requirements (the compiled acceptance criteria) and the request itself:
 *  1. Code first (deterministic): integrations with external platforms no verified component connects to, autonomous
 *     actions on external accounts, native mobile apps or hardware, and AI generation in a use case without AI.
 *  2. Code: a requirement a shipped test proves is covered.
 *  3. The decider (ADR-0039) for the rest, through the resource decision engine (ADR-0058).
 */

/** The person-facing sentence (owner wording). */
export const NOT_COVERED_TITLE = "The library doesn't cover this use case yet";
export const NOT_COVERED_WHY = "We'll notify you with priority as soon as it does.";
export const NOT_COVERED_MESSAGE = `${NOT_COVERED_TITLE}. ${NOT_COVERED_WHY}`;
export const NOT_COVERED_ACTION =
  "Nothing was built. Start a new flow limited to what the library covers (the use cases and components on /use and /catalogue), or choose verified components explicitly (`components` in the API, `--components` in the CLI).";
/** Raw reason stored on the build row (`builds.error`); `explainFailure` maps it back. */
export const NOT_COVERED_REASON = "Use case not covered by the library";

/** A covered use case may offer its covered part only when at least this share of the requirements is covered. */
export const PARTIAL_MIN_SHARE = 0.5;

export interface GateComponent {
  id: string;
  provides: string[];
  does: string;
  keywords?: string[];
}

export interface ScopeGateInput {
  need: string;
  /** Atomic requirements: the request's compiled acceptance criteria. */
  requirements: readonly string[];
  /** The covered use case (recipe) the request maps to; null when no product family matches. */
  useCase: { id: string; description: string } | null;
  /** Approved catalogue components (the only things TurbineH builds with). */
  catalog: readonly GateComponent[];
  /** Components the person chose explicitly (ids). */
  explicitComponents?: readonly string[];
  /** Requirements a test shipped with the use case proves (acceptance.yaml rules, code). */
  provenByTests?: ReadonlySet<string>;
  /** The use case or the chosen components include AI (ai-agents recipe or the TurbineH orchestrator). */
  aiIncluded: boolean;
}

export interface ScopeVerdict {
  status: "covered" | "partial" | "uncovered";
  via: "use_case" | "components" | "none";
  useCase: string | null;
  requirements: ScopeRequirement[];
  notCovered: ScopeRequirement[];
  decider: { model: string; latencyMs: number } | null;
}

/** External platforms: covered only when a verified component connects to them (its manifest names them). */
const PLATFORMS: readonly [label: string, re: RegExp][] = [
  ["social media", /\bsocial[- ](media|networks?|accounts?|channels?|platforms?)\b/i],
  ["X (Twitter)", /\b(twitter|tweets?)\b|\bx\.com\b/i],
  ["Facebook", /\bfacebook\b/i],
  ["Instagram", /\binstagram\b/i],
  ["LinkedIn", /\blinked ?in\b/i],
  ["TikTok", /\btik ?tok\b/i],
  ["YouTube", /\byou ?tube\b/i],
  ["Pinterest", /\bpinterest\b/i],
  ["Mastodon", /\bmastodon\b/i],
  ["Bluesky", /\bblue ?sky\b/i],
  ["Reddit", /\breddit\b/i],
  ["WhatsApp", /\bwhats ?app\b/i],
  ["Telegram", /\btelegram\b/i],
  ["Slack", /\bslack\b/i],
  ["Discord", /\bdiscord\b/i],
  ["SMS", /\b(sms|text messages?)\b/i],
  ["Shopify", /\bshopify\b/i],
  ["Salesforce", /\bsalesforce\b/i],
  ["HubSpot", /\bhub ?spot\b/i],
  ["Zapier", /\bzapier\b/i],
  ["QuickBooks", /\bquick ?books\b/i],
  ["Xero", /\bxero\b/i],
  ["Mailchimp", /\bmail ?chimp\b/i],
  ["Airtable", /\bairtable\b/i],
  ["Jira", /\bjira\b/i],
  ["Trello", /\btrello\b/i],
  ["Google Calendar", /\bgoogle calendar\b/i],
  ["Google Drive", /\bgoogle drive\b/i],
  ["Dropbox", /\bdropbox\b/i],
];

/** A platform named as data (an "Instagram handle" field) is fine; acting on or with it is an integration. */
const INTEGRATION_VERB =
  /\b(publish|post|share|sync|connect|integrat|import|export to|send|receiv|notif|alert|remind|schedul|pull|fetch|push|auto-?post|cross-?post|upload to|read from|log ?in with|sign ?in with)\w*/i;

/** Links, buttons and icons to a platform are plain web content, not an integration. */
const LINK_ONLY = /\b(share buttons?|links? to|profile links?|icons?|handles?|usernames?)\b/i;

/** Acting without a person: only when an agent or the system acts (a person booking "on their behalf" is fine). */
const AUTONOMOUS =
  /\bautonomous(ly)?\b|\b(ai|agent|bot|system)\b[^.]{0,40}\bon (their|his|her|the user'?s?|your|its) behalf\b|\bwithout (human|manual|a person'?s) (review|approval|confirmation|intervention)\b/i;

const NATIVE_OR_HARDWARE: readonly [label: string, re: RegExp][] = [
  [
    "a native mobile app",
    /\b(ios|android) apps?\b|\bnative (mobile )?apps?\b|\bapp store\b|\bplay store\b/i,
  ],
  ["hardware or devices", /\b(iot|bluetooth|nfc|raspberry pi|arduino|smart ?watch)\b/i],
  ["a desktop app or a video game", /\bdesktop apps?\b|\bvideo ?games?\b/i],
];

const AI =
  /\b(ai|a\.i\.|ia|llms?|gpt[\w-]*|language models?|machine learning|generative|gen ?ai|chat ?bots?|embeddings?|semantic search|rag|openai|inteligencia artificial)\b/i;

/** What a component verifiably does (manifest). Guide keywords only help the engine find candidates: a keyword never
 * makes a platform "connected" here. */
const componentText = (c: GateComponent) => `${c.id} ${c.provides.join(" ")} ${c.does}`;

/** Deterministic: why a requirement is not covered, or null when code cannot tell (ADR-0039 §1(c)). */
export function uncoveredByCode(
  text: string,
  ctx: Pick<ScopeGateInput, "catalog" | "aiIncluded">,
): string | null {
  for (const [label, re] of PLATFORMS) {
    if (!re.test(text) || !INTEGRATION_VERB.test(text) || LINK_ONLY.test(text)) continue;
    if (ctx.catalog.some((c) => re.test(componentText(c)))) continue;
    return `Integration with ${label}: no verified component connects to it yet`;
  }
  if (AUTONOMOUS.test(text))
    return "Autonomous actions without a person's confirmation: not part of any verified use case";
  for (const [label, re] of NATIVE_OR_HARDWARE)
    if (re.test(text)) return `It needs ${label}: TurbineH builds web apps only`;
  if (!ctx.aiIncluded && AI.test(text))
    return "AI generation: this use case includes no AI and no verified AI component was chosen";
  return null;
}

/** The request's parts in its own words; the first one is its headline (what the product is). */
function requestParts(need: string): string[] {
  return need
    .split(/(?<=[.!?;\n])\s+|,\s+|\s+(?:with|and|that|which|where)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !NOT_ASKED.test(s));
}

/** The request's headline in its own words: what the product is (the use case named by the person). */
export const headlineOf = (need: string): string => requestParts(need)[0] ?? need.trim();

/** Parts of a specification that exclude something ("out of scope: Slack") are not asked for. */
const NOT_ASKED =
  /\b(out of scope|not (required|needed|in scope|included|part of)|no need|won'?t|will not|excluded|future|later phase|phase 2|nice to have|don'?t|do not|never)\b/i;

/** The gate. `decider` is optional: without it, code decides and a requirement code cannot place is not covered
 * unless the use case itself is covered. */
export async function scopeGate(
  input: ScopeGateInput,
  decider?: Pick<Decider, "scopeOutside"> | null,
): Promise<ScopeVerdict> {
  const known = new Set(input.catalog.map((c) => c.id));
  const explicit = (input.explicitComponents ?? []).filter((id) => known.has(id));
  if (explicit.length > 0) {
    // The person chose verified components: exactly those are delivered, each as it was verified.
    return {
      status: "covered",
      via: "components",
      useCase: null,
      requirements: explicit.map((id) => ({
        requirement: id,
        covered: true,
        why: "Component chosen explicitly",
      })),
      notCovered: [],
      decider: null,
    };
  }
  const ctx = { catalog: input.catalog, aiIncluded: input.aiIncluded };
  const results: (ScopeRequirement | null)[] = input.requirements.map((r) => {
    const outside = uncoveredByCode(r, ctx);
    if (outside) return { requirement: r, covered: false, why: outside };
    if (input.provenByTests?.has(r))
      return { requirement: r, covered: true, why: "Proved by a test shipped with the use case" };
    return null;
  });
  // The request's own words count too. Its headline names the use case: when code finds it outside what the library
  // covers, the use case itself is not covered (no "covered part" of another product is offered). Other parts the
  // compiled requirements dropped are added as requirements.
  const [headline, ...rest] = requestParts(input.need);
  const headlineWhy = headline ? uncoveredByCode(headline, ctx) : null;
  if (headline && headlineWhy)
    results.push({
      requirement: `${headline} (the use case itself)`,
      covered: false,
      why: headlineWhy,
    });
  const reasons = new Set(results.filter((r) => r && !r.covered).map((r) => r?.why));
  for (const part of rest) {
    const why = uncoveredByCode(part, ctx);
    if (!why || reasons.has(why)) continue;
    reasons.add(why);
    results.push({ requirement: `${part} (stated in the request)`, covered: false, why });
  }

  const open = results.flatMap((r, i) => (r === null ? [i] : []));
  let deciderMeta: ScopeVerdict["decider"] = null;
  if (open.length > 0) {
    const answers = decider
      ? await decider
          .scopeOutside({
            useCase: input.useCase,
            catalog: input.catalog,
            requirements: open.map((i) => ({ index: i, text: input.requirements[i] as string })),
          })
          .catch(() => null)
      : null;
    if (answers) deciderMeta = answers.meta;
    for (const i of open) {
      const requirement = input.requirements[i] as string;
      const outside = answers?.outside[i];
      results[i] =
        outside === undefined
          ? input.useCase
            ? { requirement, covered: true, why: `Part of the ${input.useCase.id} use case` }
            : { requirement, covered: false, why: "No verified use case or component covers it" }
          : outside
            ? {
                requirement,
                covered: false,
                why: "Needs something outside the verified use case and components",
              }
            : {
                requirement,
                covered: true,
                why: input.useCase
                  ? `Part of the ${input.useCase.id} use case`
                  : "Covered by verified components",
              };
    }
  }
  const requirements = results as ScopeRequirement[];
  const notCovered = requirements.filter((r) => !r.covered);
  const coveredShare =
    requirements.length === 0 ? 0 : (requirements.length - notCovered.length) / requirements.length;
  const status: ScopeVerdict["status"] =
    requirements.length === 0 || headlineWhy
      ? "uncovered"
      : notCovered.length === 0
        ? "covered"
        : input.useCase && coveredShare >= PARTIAL_MIN_SHARE
          ? "partial"
          : "uncovered";
  return {
    status,
    via: status === "uncovered" ? "none" : input.useCase ? "use_case" : "components",
    useCase: input.useCase?.id ?? null,
    requirements,
    notCovered,
    decider: deciderMeta,
  };
}

/** Explicit name of the covered part (never the original name, which promises the uncovered parts). */
export const coveredPartName = (appName: string): string => {
  const suffix = " (covered part only)";
  return `${appName.slice(0, 60 - suffix.length).trim()}${suffix}`;
};

/** The plan's scope section and the decision a person must take before a partial build (ADR-0052). */
export function planScope(
  verdict: ScopeVerdict,
  appName: string,
): { scope: PlanScope; approval: string | null } {
  if (verdict.status !== "partial") {
    return {
      scope: {
        status: "covered",
        useCase: verdict.useCase ?? "components",
        name: appName,
        removed: [],
        message: "Every requirement of the request is covered by the library.",
      },
      approval: null,
    };
  }
  const name = coveredPartName(appName);
  const list = verdict.notCovered.map((r) => r.requirement);
  return {
    scope: {
      status: "partial",
      useCase: verdict.useCase ?? "components",
      name,
      removed: verdict.notCovered,
      message: `${NOT_COVERED_MESSAGE} ${list.length} requirement(s) of this request are not covered and were removed from scope; only the covered part can be built.`,
    },
    approval: `${COVERED_PART_APPROVAL}"${name}": the library doesn't cover ${list.length} requirement(s) yet, removed from scope — ${list.join(" · ")}`,
  };
}

/** Prefix of the explicit choice to build the covered part only (needs a person: never auto-approved). */
export const COVERED_PART_APPROVAL = "Build only the covered part, ";

/** Raw reason for an uncovered request: the requirements, readable by support and parsed by `explainFailure`. */
export const notCoveredReason = (verdict: Pick<ScopeVerdict, "notCovered">): string =>
  `${NOT_COVERED_REASON}: ${verdict.notCovered.map((r) => r.requirement.replace(/\s*\|\s*/g, " ")).join(" | ")}`;

export const parseNotCoveredReason = (raw: string): string[] | null => {
  if (!raw.startsWith(NOT_COVERED_REASON)) return null;
  const rest = raw.slice(NOT_COVERED_REASON.length).replace(/^[\s:]+/, "");
  return rest
    ? rest
        .split(" | ")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
};

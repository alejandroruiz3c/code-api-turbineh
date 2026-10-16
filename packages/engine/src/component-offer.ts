import type { Decider } from "@turbineh/decider";
import type {
  ComponentOffer,
  NotCoveredExplanation,
  OfferedComponent,
  ScopeRequirement,
} from "@turbineh/shared";
import { headlineOf, NOT_COVERED_TITLE, NOT_COVERED_WHY, type ScopeVerdict } from "./scope-gate.js";
import { PLATFORM_SERVICES, type CatalogEntry } from "./types.js";

/**
 * Components-only offer for an uncovered use case (ADR-0062, owner rules). When the library does not cover what the
 * person asked for, TurbineH offers verified components ONLY when they really implement a concrete function the person
 * asked for — precision over recall: a wrong offer is worse than none, and nothing is offered for the sake of offering.
 * The use case itself is never built, never faked; each component is delivered exactly as it was verified.
 *
 * A component is offered for a requirement only when every check passes:
 *  1. Explicit ask (code): a functional capability hint matches both the requirement and the person's own words —
 *     generic plumbing (auth, database, UI scaffolding) is never offered unless the person asked for that function.
 *  2. Servable (code): the requirement is not blocked by what the library lacks (an external platform, autonomous
 *     actions, native apps or hardware, the use case itself) — a component cannot deliver those.
 *  3. Evidence (code): a verified test of the component proves that function — an acceptance rule of the component
 *     matching the requirement, or a tested guarantee of the capability. The test is recorded in the offer.
 *  4. Judgement: the resource decision engine (ADR-0058) confirms each pair with a high bar, in one batched request.
 *     Without an answer (open engine, outage), checks 1–3 decide — except when the core of the request (its use case
 *     itself) or any part of it is blocked: then nothing is offered without the engine's judgement (when in doubt,
 *     don't offer). Code alone offers only where the gap is one a component closes by definition (no AI chosen).
 */

/** A catalogue entry as the offer sees it: plus what it declares it needs and the tests that prove what it does. */
export interface OfferEntry extends CatalogEntry {
  requires?: string[];
  /** acceptance.yaml: each test and the regexes a criterion must all match for that test to prove it. */
  acceptance?: { test: string; covers: string[] }[];
  /** guide.yaml `guarantees`: tested claims. */
  guarantees?: { claim: string; test: string }[];
}

/** Never offered on their own: platform services (API features, not code) and packs that come with other parts. */
const NOT_OFFERED: ReadonlySet<string> = new Set([
  ...PLATFORM_SERVICES,
  "security.pack.turbineh",
  "security.ai-safety.turbineh",
]);

export interface OfferHint {
  /** The function in the person's words (must match the requirement AND the request). */
  ask: RegExp;
  /** Capability a provider declares (`relations.provides`). */
  provides: string;
  /** What a verified test of the provider must say for it to prove this function. */
  proof: RegExp;
  /** The functional result the person gets, in plain words. */
  gives: string;
  /**
   * Capabilities this one already includes: when it is a candidate for a requirement, a generic provider of those is
   * not offered for the same requirement (e.g. social publishing schedules its own posts — no separate scheduler).
   */
  supersedes?: readonly string[];
}

/**
 * Functional capabilities a person can ask for explicitly, each with what proves it. Deliberately narrow: plumbing a
 * request merely implies (sessions behind an admin area, a database, forms) is not here.
 */
export const OFFER_HINTS: readonly OfferHint[] = [
  {
    ask: /\b(sign(s|ed|ing)?[- ]?(in|up)|log(s|ged|ging)?[- ]?in|login|user accounts?|passwords?|authenticat\w*)\b/i,
    provides: "auth.session",
    proof: /\b(sign|log ?in|session|password|authenticat)/i,
    gives: "sign-up, sign-in and sessions",
  },
  {
    ask: /\b(two[- ]factor|2fa|mfa|one[- ]time (codes?|passwords?)|totp)\b/i,
    provides: "auth.mfa",
    proof: /\b(totp|hotp|one[- ]time|otp|code)/i,
    gives: "two-factor one-time codes",
  },
  {
    ask: /\b(workspaces?|organi[sz]ations?|invite (team )?members?|team members?)\b/i,
    provides: "authz.organizations",
    proof: /\b(organi[sz]ation|workspace|member|invit)/i,
    gives: "workspaces with members and invitations",
  },
  {
    ask: /\b(user roles?|roles? (and|&) permissions?|permissions? per role|role-based)\b/i,
    provides: "authz.roles",
    proof: /\b(role|permission|member)/i,
    gives: "roles and permission checks",
  },
  {
    ask: /\b(payments?|pays?|checkout|stripe|charg(e|es|ed|ing) (the )?(customers?|users?|cards?))\b/i,
    provides: "payments.checkout",
    proof: /\b(checkout|payment|webhook|charge)/i,
    gives: "online payments with Stripe",
  },
  {
    ask: /\b(subscri(be|bes|bed|bing|ptions?)|billing|recurring payments?)\b/i,
    provides: "payments.subscriptions",
    proof: /\b(subscri|billing|portal)/i,
    gives: "subscriptions with Stripe Billing",
  },
  {
    ask: /\b(ai|a\.i\.|llms?|gpt[\w-]*|language models?|generative|gen ?ai|chat ?bots?|inteligencia artificial)\b/i,
    provides: "ai.orchestrator",
    proof: /\banswers?\b/i,
    gives:
      "AI generation through the TurbineH orchestrator (with the AI Safety Pack): your app calls it with its own prompt",
  },
  {
    ask: /\b(schedul\w*|every (day|week|month|morning|evening|night|hour)|daily|weekly|monthly|nightly|cron)\b/i,
    provides: "jobs.scheduled",
    proof: /\b(schedul|cron|every (morning|day)|runs once)/i,
    gives: "jobs that run on a schedule (cron), once per scheduled time",
  },
  {
    ask: /\b(background (jobs?|tasks?|processing)|job queue|retr(y|ies) with backoff)\b/i,
    provides: "jobs.queue",
    proof: /\b(queue|retr|background)/i,
    gives: "a background job queue with retries",
  },
  {
    ask: /\b(e-?mail(ed|s)? (notifications?|alerts?|reminders?|digests?|confirmations?)|(send|sends|sent)\b[^.]{0,30}\be-?mails?|(by|via) e-?mail)\b/i,
    provides: "email.transactional",
    proof: /\b(e-?mail|send)/i,
    gives: "transactional email",
  },
  {
    ask: /\b(upload(s|ed|ing)?|attachments?)\b/i,
    provides: "storage.private-uploads",
    proof: /\b(upload|file)/i,
    gives: "private file uploads with size and type limits",
  },
  {
    ask: /\b(audit (log|trail)s?|change history|history of changes|activity log)\b/i,
    provides: "domain.audit-log",
    proof: /\b(audit|log|history)/i,
    gives: "an append-only audit log",
  },
  {
    ask: /\bimport\w*\b[^.]{0,40}\bcsv\b|\bcsv imports?\b/i,
    provides: "data.csv-import",
    proof: /\b(csv|import|row)/i,
    gives: "CSV import with validation",
  },
  {
    ask: /\bexport\w*\b[^.]{0,40}\bcsv\b|\bcsv exports?\b/i,
    provides: "data.csv-export",
    proof: /\b(csv|export|formula)/i,
    gives: "CSV export",
  },
  {
    ask: /\b(generat\w*|export\w*|download\w*|creat\w*)\b[^.]{0,30}\bpdfs?\b/i,
    provides: "files.pdf",
    proof: /\bpdf/i,
    gives: "PDF generation",
  },
  {
    ask: /\bqr ?codes?\b/i,
    provides: "files.qr",
    proof: /\bqr/i,
    gives: "QR code generation",
  },
  {
    ask: /\b(rss|atom) feeds?\b/i,
    provides: "content.rss",
    proof: /\b(rss|atom|feed)/i,
    gives: "RSS and Atom feeds",
  },
  {
    // ADR-0067: publishing to LinkedIn, Facebook Pages, Instagram and X, with a person in the loop.
    ask: /\b(publish\w*|post(s|ed|ing)?|cross-?post\w*)\b[^.]{0,60}\b(social|linkedin|facebook|instagram|twitter)\b|\b(social (media|network)s?|linkedin|facebook|instagram|twitter)\b[^.]{0,40}\b(publish\w*|post(s|ed|ing)?)\b/i,
    provides: "social.publish",
    proof: /\bpublish/i,
    gives:
      "publishing posts to LinkedIn, Facebook Pages, Instagram and X at a scheduled time, each post created and (when required) approved by a person — never autonomously",
    supersedes: ["jobs.scheduled", "jobs.queue"],
  },
  {
    ask: /\b(connect\w*|link\w*|sign in with|log in with)\b[^.]{0,60}\b(social (media )?(accounts?|networks?|profiles?)|linkedin|facebook|instagram|twitter)\b/i,
    provides: "social.oauth",
    proof: /\b(connect|oauth|consent)/i,
    gives:
      "connecting LinkedIn, Facebook Page + Instagram and X accounts (OAuth, tokens encrypted at rest)",
  },
  {
    ask: /\b(engagement|likes|impressions|(post|social( media)?) (metrics|analytics|performance|stats|statistics))\b/i,
    provides: "social.metrics",
    proof: /\b(metric|likes|engagement)/i,
    gives: "engagement metrics (likes, comments, shares, impressions) of the posts it published",
  },
  {
    ask: /\bkanban\b/i,
    provides: "ui.kanban",
    proof: /\b(kanban|column|board|card)/i,
    gives: "a kanban board",
  },
  {
    ask: /\bwait ?list\b/i,
    provides: "growth.waitlist",
    proof: /\b(wait ?list|join)/i,
    gives: "a waitlist",
  },
];

/**
 * Why the gate's code left a requirement out that a component cannot change: an external platform, autonomous actions,
 * a native app or hardware. Such a requirement is never "served" by a component (it would promise what is not built).
 * The scope question's broader "needs something outside" is not final here: the offer's own judgement decides.
 */
const BLOCKED = /^(Integration with |Autonomous actions|It needs )/;
/** AI generation is not covered only because no AI component was chosen: the orchestrator removes exactly that. */
const NEEDS_AI = /^AI generation/;

/** Components in one offer (the package stays something a person can review). */
const MAX_OFFERED = 6;

const SUFFIX = /\s*\((the use case itself|stated in the request)\)$/;
const isUseCaseItself = (r: ScopeRequirement) => r.requirement.endsWith("(the use case itself)");
/** The requirement's own words, without the gate's labels. */
const plain = (requirement: string) => requirement.replace(SUFFIX, "").trim();

const safeRegex = (source: string): RegExp | null => {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
};

/** The verified test that proves `hint`'s function for this requirement, or null (then nothing is offered). */
export function evidenceFor(requirement: string, e: OfferEntry, hint: OfferHint): string | null {
  // An acceptance rule of the component whose patterns all match the requirement: it proves this very requirement.
  for (const rule of e.acceptance ?? []) {
    const res = rule.covers.map(safeRegex);
    if (res.length > 0 && res.every((re) => re?.test(requirement)) && hint.proof.test(rule.test))
      return rule.test;
  }
  // Otherwise a verified test of the function itself: a tested guarantee (guide.yaml) or an acceptance test.
  for (const g of e.guarantees ?? [])
    if (hint.proof.test(g.claim) || hint.proof.test(g.test)) return `${g.claim} — ${g.test}`;
  for (const rule of e.acceptance ?? []) if (hint.proof.test(rule.test)) return rule.test;
  return null;
}

/** One provider per capability: TurbineH's own module first (it is built for apps like these). */
function providerOf(capability: string, entries: readonly OfferEntry[]): OfferEntry | null {
  const all = entries.filter((e) => e.provides.includes(capability) && !NOT_OFFERED.has(e.id));
  return all.find((e) => e.id.endsWith(".turbineh")) ?? all[0] ?? null;
}

interface Candidate {
  entry: OfferEntry;
  hint: OfferHint;
  evidence: string;
}

/**
 * Checks 1–3 for one requirement (code): explicitly asked in the request, servable, and proved by a verified test.
 * Exported for tests and the labelled precision set (bench/offers).
 */
export function candidatesFor(
  r: ScopeRequirement,
  need: string,
  entries: readonly OfferEntry[],
): Candidate[] {
  if (isUseCaseItself(r)) return [];
  const text = plain(r.requirement);
  if (!r.covered && BLOCKED.test(r.why)) return [];
  const out: Candidate[] = [];
  for (const hint of OFFER_HINTS) {
    if (!hint.ask.test(text) || !hint.ask.test(need)) continue;
    // A requirement left out only for lack of AI can be served by the orchestrator, and by nothing else.
    if (!r.covered && NEEDS_AI.test(r.why) !== (hint.provides === "ai.orchestrator")) continue;
    const entry = providerOf(hint.provides, entries);
    if (!entry || out.some((c) => c.entry.id === entry.id)) continue;
    const evidence = evidenceFor(text, entry, hint);
    if (evidence) out.push({ entry, hint, evidence });
  }
  // A specific component that already includes a generic capability wins over its generic provider.
  const superseded = new Set(out.flatMap((c) => c.hint.supersedes ?? []));
  return out.filter((c) => !superseded.has(c.hint.provides));
}

export interface OfferResult {
  /** Offered components (served requirements in the request's order) plus what they declare they need. */
  components: OfferedComponent[];
  /** Requirements no offered component implements: out of the package's scope. */
  outOfScope: ScopeRequirement[];
  /** True when the use case itself (the request's headline) is not covered: the core is not included. */
  coreNotIncluded: boolean;
  /** Who confirmed the matches: the decision engine, or code (checks 1–3) when it had no answer. */
  decidedBy: "decider" | "code";
  decider: { model: string; latencyMs: number } | null;
}

/**
 * Which verified components really implement functions the person asked for in an uncovered request. Null when none
 * does: the refusal then stands, with the priority notice.
 */
export async function offerComponents(
  input: {
    need: string;
    verdict: Pick<ScopeVerdict, "requirements" | "notCovered">;
    catalog: readonly OfferEntry[];
  },
  decider?: Pick<Decider, "componentsServe"> | null,
): Promise<OfferResult | null> {
  const requirements = input.verdict.requirements;
  const items = requirements
    .map((r, index) => ({
      index,
      r,
      text: plain(r.requirement),
      candidates: candidatesFor(r, input.need, input.catalog),
    }))
    .filter((x) => x.candidates.length > 0);
  if (items.length === 0) return null;

  // One batched request to the resource decision engine; no answer (open engine, older engine, outage) → code.
  const ask = async () =>
    typeof decider?.componentsServe === "function"
      ? decider.componentsServe({
          need: input.need,
          requirements: items.map((x) => ({
            index: x.index,
            text: x.text,
            candidates: x.candidates.map((c) => ({
              id: c.entry.id,
              does: c.entry.does,
              evidence: c.evidence,
            })),
          })),
        })
      : null;
  const answer = await ask().catch(() => null);
  const coreNotIncluded = requirements.some((r) => isUseCaseItself(r) && !r.covered);
  // When in doubt, don't offer: if the core of the request (its use case itself) is not covered, or any part of it
  // is blocked (an external platform, autonomous actions, a native app or hardware), only the decision engine's
  // judgement can tell whether a component still delivers a real, standalone piece of what the person asked for.
  const needsJudgement = requirements.some(
    (r) => !r.covered && (isUseCaseItself(r) || BLOCKED.test(r.why)),
  );
  if (!answer && needsJudgement) return null;

  const byId = (id: string) => input.catalog.find((e) => e.id === id);
  const offered = new Map<string, OfferedComponent>();
  for (const x of items) {
    const judged = answer?.serves[x.index];
    // The engine can only narrow the code's candidates, never add to them.
    const kept =
      judged === undefined ? x.candidates : x.candidates.filter((c) => judged.includes(c.entry.id));
    const requirement = x.r.requirement;
    for (const c of kept) {
      const existing = offered.get(c.entry.id);
      if (existing) {
        if (!existing.serves.includes(requirement)) {
          existing.serves.push(requirement);
          existing.proof.push({ requirement, test: c.evidence });
        }
        continue;
      }
      if (offered.size >= MAX_OFFERED) continue;
      offered.set(c.entry.id, {
        id: c.entry.id,
        does: c.entry.does,
        gives: c.hint.gives,
        serves: [requirement],
        proof: [{ requirement, test: c.evidence }],
      });
    }
  }
  if (offered.size === 0) return null;
  // What the offered components declare they need (e.g. the AI orchestrator's AI Safety Pack).
  for (const c of [...offered.values()]) {
    for (const dep of byId(c.id)?.requires ?? []) {
      const e = byId(dep);
      if (e && !offered.has(dep))
        offered.set(dep, {
          id: dep,
          does: e.does,
          gives: `required by ${c.id}`,
          serves: [],
          proof: [],
          requiredBy: c.id,
        });
    }
  }
  const served = new Set([...offered.values()].flatMap((c) => c.serves));
  const notCovered = new Map(input.verdict.notCovered.map((r) => [r.requirement, r.why]));
  const outOfScope = requirements
    .filter((r) => !served.has(r.requirement))
    .map((r) => ({
      requirement: r.requirement,
      covered: false,
      why:
        notCovered.get(r.requirement) ??
        "Not part of a components-only package: the use case itself is not built",
    }));
  return {
    components: [...offered.values()],
    outOfScope,
    coreNotIncluded,
    decidedBy: answer ? "decider" : "code",
    decider: answer?.meta ?? null,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** How to accept an offer on each surface: a plan to approve, or a direct build to send again. */
export function offerApproval(planId: string | null): ComponentOffer["approve"] {
  return planId
    ? {
        web: 'Press "Build the verified components" on the plan.',
        api: `POST /v1/plans/${planId}/generate with {"approve": true}`,
        cli: `turbineh resume ${planId} --approve`,
        mcp: `call resume with {"id": "${planId}", "approve": true}`,
      }
    : {
        web: 'Press "Build the verified components".',
        api: 'POST /v1/builds again with the same prompt and "components_only": true',
        cli: 'turbineh build "<the same spec>" --approve',
        mcp: "call build again with the same spec and approve: true",
      };
}

/** The offer as people and agents read it: what they get working, and plainly what is not included. */
export function componentOffer(
  result: OfferResult,
  input: { need: string; planId: string | null },
): ComponentOffer {
  const useCase = clip(headlineOf(input.need), 80);
  const main = result.components.filter((c) => !c.requiredBy);
  const gives = [...new Set(main.map((c) => c.gives))];
  const sentence = (t: string) => t.replace(/[.\s]+$/, "");
  const missing = result.outOfScope
    .filter((r) => !isUseCaseItself(r))
    .map((r) => sentence(plain(r.requirement)));
  const app = "the application itself (its screens, data and flows) — only these components";
  return {
    kind: "components_only",
    title: `Verified components for your request “${useCase}”: ${main.map((c) => c.id).join(", ")}`,
    name: clip(`Verified components: ${gives.map((g) => g.split(" (")[0]).join(", ")}`, 60),
    youGet: `You get ${gives.join("; ")} — working and verified, as separate components to add to your app.`,
    notIncluded: result.coreNotIncluded
      ? `Not included — the core of your request: “${useCase}”${missing.length ? `, and: ${missing.join("; ")}` : ""}. This package is not that product.`
      : `Not included: ${missing.length ? `${missing.join("; ")}; and ` : ""}${app}. This package is not the complete product you described.`,
    coreNotIncluded: result.coreNotIncluded,
    components: result.components,
    outOfScope: result.outOfScope,
    approve: offerApproval(input.planId),
  };
}

export const PRIORITY_NOTICE =
  "We recorded your request and will notify you with priority as soon as the library covers it (by email when your account's address is known).";

/** The explanation of an uncovered request (ADR-0062): the same model on the web, the API, the CLI and MCP. */
export function notCoveredExplanation(input: {
  need: string;
  notCovered: readonly ScopeRequirement[];
  offer: ComponentOffer | null;
}): NotCoveredExplanation {
  const offer = input.offer;
  return {
    title: NOT_COVERED_TITLE,
    useCase: headlineOf(input.need),
    notCovered: [...input.notCovered],
    priority: PRIORITY_NOTICE,
    canDoNow: offer
      ? `We can prepare a components-only package now, only for functions you asked for that verified components really implement. ${offer.youGet} ${offer.notIncluded} Nothing is built until you approve it.`
      : `No verified component implements a function you asked for, so nothing was built and nothing is offered. ${NOT_COVERED_WHY} Meanwhile you can start a new flow limited to what the library covers (the use cases and components on /use and /catalogue), or choose verified components explicitly (\`components\` in the API, \`--components\` in the CLI).`,
    offer,
  };
}

/** Prefix of the explicit choice to build a components-only package (needs a person: never auto-approved). */
export const COMPONENTS_ONLY_APPROVAL = "Build verified components only, ";

/** The plan's decision line for an offer (first in `needsApproval`). */
export function componentsOnlyApproval(offer: ComponentOffer): string {
  const main = offer.components.filter((c) => !c.requiredBy).map((c) => c.id);
  return `${COMPONENTS_ONLY_APPROVAL}"${offer.name}": the library doesn't cover this use case yet, so it is not built. ${offer.youGet} (${main.join(", ")}). ${offer.notIncluded}`;
}

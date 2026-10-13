import type { BuildSpec } from "./build-spec.js";

/**
 * Non-functional requirements are never data entities (ADR-0037 §D3). "Rate limits", "input limits", "prompt-injection
 * protection", "timeouts", "logging"… describe how the app behaves, not records people create and edit. A small model
 * sometimes turns them into entities (Frontiers rerun: `RateLimitTracker` with CRUD pages and E2E), which ships an
 * editable table nobody needs and an extra E2E suite that can fail the gate. The entities prompt says so, and this
 * deterministic guard removes what slips through and maps it to the capability (and so the component) that implements
 * it; the requirement itself stays an acceptance criterion.
 */
export type NonFunctionalKind =
  | "rate-limits"
  | "abuse-protection"
  | "timeouts-retries"
  | "logging"
  | "caching"
  | "idempotency"
  | "monitoring";

export interface NonFunctionalRequirement {
  kind: NonFunctionalKind;
  /** The entity (or page) the model proposed for it, removed from the spec. */
  source: string;
  /** Capabilities that implement it (selected like any other capability; the Security Pack is always injected). */
  capabilities: BuildSpec["capabilities"];
}

/** Words of a PascalCase / camelCase / kebab-case name, lowercased: "RateLimitTracker" → ["rate","limit","tracker"]. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Patterns on the joined words ("rate limit tracker"). Precise on purpose: "StageLimit", "Log" (a habit log in a
 * tracker), "Session" (a booking) or "Metric" (analytics) are real entities and are kept.
 */
const RULES: { kind: NonFunctionalKind; pattern: RegExp }[] = [
  {
    kind: "rate-limits",
    pattern:
      /\b(rate ?limit\w*|ratelimit\w*|throttl\w*|request (count|counter|quota|limit)s?|api quota|rate quota)\b/,
  },
  {
    kind: "abuse-protection",
    pattern:
      /\b(prompt injection|injection\w*|(input|message|character|length|size|token|upload) limits?|moderation\w*|abuse\w*|spam\w*|captcha\w*|guardrails?|safety (rule|filter|check)s?|security (rule|setting|policy|config)s?|denylist|blocklist|ip (block|ban)s?)\b/,
  },
  {
    kind: "timeouts-retries",
    pattern: /\b(timeouts?|time out|retry|retries|backoff|circuit breakers?)\b/,
  },
  {
    kind: "logging",
    pattern:
      /\b(audit( log| trail| entry| event| record)?s?|(access|request|error|api|system|app|security|debug|event|activity) logs?|logging|log entr(y|ies) for requests|telemetry)\b/,
  },
  { kind: "caching", pattern: /\b(cache|caches|caching|cache entr(y|ies))\b/ },
  { kind: "idempotency", pattern: /\b(idempotenc\w*|idempotency keys?)\b/ },
  { kind: "monitoring", pattern: /\b(monitoring|health ?checks?|uptime|alerting)\b/ },
];

/** Capabilities that implement each kind. AI apps protect model input with the AI Safety Pack. */
export function capabilitiesFor(kind: NonFunctionalKind, ai: boolean): BuildSpec["capabilities"] {
  switch (kind) {
    case "rate-limits":
      return ai ? ["ops.rate-limit", "security.ai-safety"] : ["ops.rate-limit"];
    case "abuse-protection":
      return ai
        ? ["security.ai-safety", "ops.rate-limit", "data.validation"]
        : ["ops.rate-limit", "data.validation"];
    case "timeouts-retries":
      return ["ops.retry"];
    case "logging":
    case "monitoring":
      return ["observability.logging"];
    case "idempotency":
      return ["ops.idempotency"];
    case "caching":
      return [];
  }
}

/** The kind of non-functional requirement a name describes, or null when it is a real domain concept. */
export function nonFunctionalKind(name: string): NonFunctionalKind | null {
  const words = nameWords(name).join(" ");
  return RULES.find((r) => r.pattern.test(words))?.kind ?? null;
}

/** Instruction appended to the entities part of the compiler (the model's half of the rule). */
export const NON_FUNCTIONAL_INSTRUCTION =
  "Never list non-functional requirements as entities: rate limits, request counters, input or size limits, " +
  "prompt-injection or abuse protection, spam checks, timeouts, retries, logging, audit trails, caching, monitoring. " +
  "TurbineH implements those with its security and AI safety components; they are not records people create or edit.";

/**
 * Removes non-functional "entities" (and pages named after them) and adds the capabilities that implement them.
 * Idempotent; returns the spec unchanged when there is nothing to remove.
 */
export function separateNonFunctional(spec: BuildSpec): {
  spec: BuildSpec;
  requirements: NonFunctionalRequirement[];
} {
  const ai =
    spec.recipe === "ai-agents" ||
    spec.capabilities.includes("ai.orchestrator") ||
    spec.capabilities.includes("security.ai-safety");
  const requirements: NonFunctionalRequirement[] = [];
  const entities = spec.entities.filter((e) => {
    const kind = nonFunctionalKind(e.name);
    if (!kind) return true;
    requirements.push({ kind, source: e.name, capabilities: capabilitiesFor(kind, ai) });
    return false;
  });
  // Pages for a removed entity ("/rate-limit-trackers") or named after a non-functional concern.
  const removed = new Set(requirements.map((r) => nameWords(r.source).join("-")));
  const pages = spec.pages.filter((p) => {
    const segments = p.path.split("/").filter((s) => s && !s.startsWith(":"));
    return !segments.some(
      (s) => removed.has(s) || removed.has(s.replace(/s$/, "")) || nonFunctionalKind(s) !== null,
    );
  });
  if (requirements.length === 0 && pages.length === spec.pages.length)
    return { spec, requirements };
  // A removed entity may be referenced by another one ("rateLimitTrackerId"): such a field is dropped as well.
  const refs = new Set(
    requirements.map((r) => r.source.charAt(0).toLowerCase() + r.source.slice(1)),
  );
  const cleaned = entities.map((e) => ({
    ...e,
    fields: e.fields.filter((f) => !refs.has(f.name.replace(/Ids?$/, ""))),
  }));
  return {
    spec: {
      ...spec,
      entities: cleaned.filter((e) => e.fields.length > 0),
      // Pages must stay non-empty (schema): keep the original list when every page was non-functional.
      pages: pages.length > 0 ? pages : spec.pages,
      capabilities: [
        ...new Set([...spec.capabilities, ...requirements.flatMap((r) => r.capabilities)]),
      ],
    },
    requirements,
  };
}

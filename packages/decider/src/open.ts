import type {
  CapabilityDecision,
  DecisionEngine,
  Decider,
  HedgeAttempt,
  HedgeRequest,
  Hedged,
  IntentInput,
  IntentVerdict,
  SelectionCandidate,
  SelectionInput,
  SelectionResult,
} from "./contract.js";

/**
 * Open minimal fallback of the resource decision engine (ADR-0058). Deterministic heuristics, no model calls, no
 * keys: the open library builds, tests and runs with it. It is deliberately simple — TurbineH's engine (decision
 * questions, calibrated thresholds, backends) is private and runs in production.
 *
 * - Selection: approved components that declare the capability, in catalogue order.
 * - Intent: the product family whose public description shares the most words with the request; no optional
 *   capability is inferred (recipes bring their defaults); a short list of obviously abusive requests is refused.
 * - Every other decision has no answer here, so the callers' deterministic code decides.
 * - The gateway never hedges.
 */

const OPEN_MODEL = "open-heuristic";

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .map((w) => w.replace(/(ies|es|s)$/, "")),
  );

/** Confidence of a Choice from its probabilities: (p_max − 1/n) / (1 − 1/n). */
const choiceConfidence = (ps: number[]): number => {
  const n = ps.length;
  if (n < 2) return 1;
  return Math.max(0, (Math.max(...ps) - 1 / n) / (1 - 1 / n));
};

const ABUSE: readonly [id: string, re: RegExp][] = [
  ["malware", /\b(malware|ransomware|keylogger|credential steal\w*|botnet|ddos)\b/i],
  ["phishing", /\bphishing\b/i],
];

export function openIntent(input: IntentInput): IntentVerdict {
  const want = words(input.prompt);
  const families = Object.keys(input.recipes).filter((id) => id !== "out_of_scope");
  const scores = families.map((id) => {
    const have = words(input.recipes[id] ?? "");
    return [...have].filter((w) => want.has(w)).length;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  const best = scores.indexOf(Math.max(0, ...scores));
  const probabilities: Record<string, number> = {};
  families.forEach((id, i) => (probabilities[id] = total > 0 ? (scores[i] ?? 0) / total : 0));
  if ("out_of_scope" in input.recipes) probabilities.out_of_scope = total > 0 ? 0 : 1;
  const choice = total > 0 && best >= 0 ? (families[best] as string) : "out_of_scope";
  const abuse = Object.fromEntries(ABUSE.map(([id, re]) => [id, re.test(input.prompt) ? 1 : 0]));
  return {
    decisions: {
      recipe: { choice, confidence: choiceConfidence(Object.values(probabilities)), probabilities },
      capabilities: {},
      abuse,
      deciderModel: OPEN_MODEL,
      deciderLatencyMs: 0,
    },
    capabilities: [],
    abuse: Object.entries(abuse).filter(([, p]) => p > 0),
  };
}

export function openSelection<C extends SelectionCandidate>(
  input: SelectionInput<C>,
): SelectionResult<C> {
  const decisions: CapabilityDecision<C>[] = Object.entries(input.candidates).map(([cap, cs]) => {
    const covers = Object.fromEntries(cs.map((c) => [c.id, c.provides.includes(cap) ? 1 : 0]));
    const risk = Object.fromEntries(cs.map((c) => [c.id, 0]));
    const ranked = cs.filter((c) => c.status === "approved" && c.provides.includes(cap));
    const top = ranked[0];
    return {
      capability: cap,
      ranked,
      best: top ? { id: top.id, p: 1 } : null,
      covers,
      risk,
      trigger: cs.length === 0 ? "T1" : ranked.length === 0 ? "T2" : null,
    };
  });
  return {
    decisions,
    decider: { backend: "heuristic", model: OPEN_MODEL, latencyMs: 0, requests: 0, questions: 0 },
  };
}

export const openDecider: Decider = {
  id: "heuristic",
  selectionVersion: "open-1",
  selectComponents: async (input) => openSelection(input),
  classifyIntent: async (input) => openIntent(input),
  entityKinds: async () => null,
  scopeOutside: async () => null,
  chooseApp: async () => null,
  triageFindings: async () => null,
  fixableFindings: async () => null,
  matchCriteria: async () => null,
  businessRules: async () => [],
};

export const openEngine: DecisionEngine = {
  edition: "open",
  version: "0.1.0",
  fromEnv: () => openDecider,
  forPlanning: () => null,
  hedging: {
    delayMs: () => 0,
    async run<A extends HedgeAttempt>(request: HedgeRequest<A>): Promise<Hedged<A>> {
      const r = await request.attempt(request.model, [AbortSignal.timeout(request.timeoutMs)]);
      return { ...r, hedge: "none" };
    },
  },
};

/**
 * Interface of TurbineH's resource decision engine (ADR-0058). The pipeline asks it which recipe, capabilities,
 * components, app, scope, rules and evidence to use; it answers with typed verdicts. The proprietary engine (decision
 * questions, prompts, thresholds, calibration, backend adapters, hedging policy) lives in a private package; this
 * repository ships the interface and an open minimal fallback (`open.ts`, deterministic heuristics, no model calls).
 *
 * The private engine imports only types from this file and receives every runtime capability it needs (the public
 * decision API client) through `DecisionIO`, so it has no runtime dependencies.
 */
import type {
  ChoiceResponse,
  EntryType,
  NoulResponse,
  Question,
  Questions,
  ScoreResponse,
  Usage,
} from "@typesafe-ai/sdk";

export type { EntryType, Question, Questions, Usage };
export type Answer = ChoiceResponse | ScoreResponse | NoulResponse;

// ---------------------------------------------------------------------------------------------------------------
// Runtime capabilities given to the engine (public SDK, no keys of its own)
// ---------------------------------------------------------------------------------------------------------------

export interface AskOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** One client of a `/v1/systemone`-compatible decision API (public SDK). */
export interface SystemOneClientConfig {
  apiKey: string;
  /** Default model id of the client. */
  model: string;
  baseURL?: string;
  timeoutMs: number;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface SystemOneReply {
  model: string;
  answers: Record<string, Answer>;
  usage: Usage;
}

export interface SystemOneClient {
  call(
    request: { state: EntryType; questions: Questions; model: string },
    opts?: AskOptions,
  ): Promise<SystemOneReply>;
}

export interface DecisionIO {
  systemOne(config: SystemOneClientConfig): SystemOneClient;
}

/** Configuration the engine reads (the worker passes its validated env; the web passes process.env). */
export interface DeciderEnv {
  TYPESAFE_API_KEY?: string | undefined;
  AI_GATEWAY_TYPESAFE_KEY?: string | undefined;
  OPEN_DECIDER_BASE_URL?: string | undefined;
  DECIDER_PRIMARY?: string | undefined;
  DECIDER_FALLBACK?: string | undefined;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// Decision points
// ---------------------------------------------------------------------------------------------------------------

/** Component selection: what the engine sees about a candidate (a short card, never the full manifest). */
export interface SelectionCandidate {
  id: string;
  status: string;
  provides: string[];
  card: string;
}

export interface SelectionInput<C extends SelectionCandidate = SelectionCandidate> {
  app: { recipe: string; summary: string; acceptance_criteria: string[] };
  /** Candidates per capability, already filtered to the capability (catalog lookup / retrieval). */
  candidates: Record<string, C[]>;
  /** Plain-language name of each capability (the capability id when absent). */
  labels?: Readonly<Record<string, string>>;
}

export interface CapabilityDecision<C extends SelectionCandidate = SelectionCandidate> {
  capability: string;
  /** Eligible candidates, best first. */
  ranked: C[];
  best: { id: string; p: number } | null;
  covers: Record<string, number>;
  risk: Record<string, number>;
  /** Backup Coder triggers (PLAN §2.4): T1 no candidate, T2 none covers the capability. */
  trigger: "T1" | "T2" | null;
  /** Approved providers ranked although none was judged as covering (ADR-0055). */
  catalogueFallback?: boolean;
}

export interface SelectionResult<C extends SelectionCandidate = SelectionCandidate> {
  decisions: CapabilityDecision<C>[];
  decider: {
    backend: string;
    model: string;
    latencyMs: number;
    requests: number;
    questions: number;
    /** True when the selection came from the selection cache (no decision call). */
    cached?: boolean;
  };
}

/** Intent classification of a request: product family, optional capabilities, Abuse Guard. */
export interface IntentInput {
  prompt: string;
  /** Product families (recipes) and their public descriptions, plus `out_of_scope`. */
  recipes: Readonly<Record<string, string>>;
}

export interface IntentDecisions {
  recipe: { choice: string; confidence: number; probabilities: Record<string, number> };
  capabilities: Record<string, number>;
  abuse: Record<string, number>;
  deciderModel: string;
  deciderLatencyMs: number;
}

export interface IntentVerdict {
  decisions: IntentDecisions;
  /** Optional capabilities the request needs (always-on capabilities are added by the compiler). */
  capabilities: string[];
  /** Abuse Guard findings that reject the request (empty = accepted). */
  abuse: [id: string, p: number][];
}

/** Entity kinds the deterministic rules were unsure of. */
export interface EntityKindsInput {
  prompt: string;
  /** Every entity of the spec: name → "field: type, …". */
  entities: Record<string, string>;
  /** Names of the entities to decide (in order). */
  unsure: string[];
}

export interface EntityKindsVerdict {
  /** Accepted answers only; an entity absent here keeps the code's classification. */
  kinds: Record<string, { kind: string; confidence: number; reason: string }>;
  latencyMs: number;
}

/** Scope gate (ADR-0052): requirements code could not place. */
export interface ScopeInput {
  useCase: { id: string; description: string } | null;
  catalog: readonly { id: string; does: string }[];
  /** Requirements to decide, by their index in the gate's list. */
  requirements: { index: number; text: string }[];
}

export interface ScopeAnswer {
  /** index → true when the requirement needs something outside the covered scope. Absent = no answer. */
  outside: Record<number, boolean>;
  meta: { model: string; latencyMs: number };
}

/**
 * Uncovered use case (ADR-0062): which verified components implement a concrete function each requirement asks for.
 * The candidates are a deterministic shortlist from the approved catalogue (explicit capability match + evidence); the
 * engine judges each pair with a high bar — precision over recall, a wrong offer is worse than none.
 */
export interface ServeInput {
  /** The request in the person's words. */
  need: string;
  requirements: {
    index: number;
    text: string;
    /**
     * Shortlisted approved components: id, what they do (manifest) and the verified test that proves the function
     * (acceptance rule or tested guarantee). Only explicitly requested functions with such evidence are shortlisted.
     */
    candidates: { id: string; does: string; evidence: string }[];
  }[];
}

export interface ServeAnswer {
  /** index → ids of the candidates that implement the requirement's function. Absent = no answer. */
  serves: Record<number, string[]>;
  meta: { model: string; latencyMs: number };
}

/** Which app of a monorepo receives a capability. */
export interface AppChoiceInput {
  /** Next.js apps ("" = repository root) and their dependencies. */
  apps: { dir: string; dependencies: string[] }[];
  /** The person's need, when known. */
  need?: string;
}

export interface AppChoiceAnswer {
  /** The app chosen, or null when the answer named none. */
  dir: string | null;
  confidence: number;
  /** True when the answer is one of the apps and confident enough to be used. */
  accepted: boolean;
}

/** Remediation: static findings of a generated app. */
export interface FindingInput {
  path: string;
  message: string;
  explain: string;
}

export type FixStrategy = "local" | "human";

/** Acceptance criterion → test that proves it (after the deterministic pass). */
export interface CriteriaInput {
  summary: string;
  /** Label of "no listed test proves it" (also the evidence text of an open criterion). */
  notVerified: string;
  items: {
    index: number;
    criterion: string;
    /** Candidate tests (evidence lines) that passed the refusal and actor checks. */
    tests: string[];
    /** Evidence line → key steps and assertions. */
    detail: Record<string, string[]>;
  }[];
}

/** index → matched test (null = open) and its confidence. Absent = no answer. */
export type CriteriaMatches = Record<number, { evidence: string | null; confidence: number }>;

/** T3 business rules (ADR-0023). */
export interface RulesInput {
  summary: string;
  /** The recipe's description. */
  recipe: string;
  criteria: string[];
  /** Generated entities with CRUD and a rules module: name → "field (type)". */
  entities: Record<string, string[]>;
  /** Generated entity → generated entities it references. */
  links: Record<string, string[]>;
}

export type Operation = "create" | "update";

export interface RuleCandidate {
  criterion: string;
  isRule: number;
  covered: number;
  entity: string | null;
  entityConfidence: number;
  complexity: number;
  /** When the rule runs: on create, on update or both. */
  operations: Operation[];
  /** Other generated entities whose records the rule reads (linked by a reference field). */
  related: string[];
  selected: boolean;
  reason: string;
}

/**
 * A decider bound to its backends: every resource decision of the pipeline. Methods that may have no answer return
 * null; callers then decide with code. Errors propagate (callers keep their own fallbacks).
 */
export interface Decider {
  /** Backend id for logs and metrics ("jev", "open", or "heuristic" for the open fallback). */
  readonly id: string;
  /** Version of the selection policy: part of the selection cache key. */
  readonly selectionVersion: number | string;
  selectComponents<C extends SelectionCandidate>(
    input: SelectionInput<C>,
  ): Promise<SelectionResult<C>>;
  classifyIntent(input: IntentInput): Promise<IntentVerdict>;
  entityKinds(input: EntityKindsInput): Promise<EntityKindsVerdict | null>;
  scopeOutside(input: ScopeInput): Promise<ScopeAnswer | null>;
  componentsServe(input: ServeInput): Promise<ServeAnswer | null>;
  chooseApp(input: AppChoiceInput): Promise<AppChoiceAnswer | null>;
  triageFindings(findings: FindingInput[]): Promise<FixStrategy[] | null>;
  fixableFindings(findings: FindingInput[]): Promise<boolean[] | null>;
  matchCriteria(input: CriteriaInput): Promise<CriteriaMatches | null>;
  businessRules(input: RulesInput): Promise<RuleCandidate[]>;
}

// ---------------------------------------------------------------------------------------------------------------
// Gateway hedging (ADR-0046)
// ---------------------------------------------------------------------------------------------------------------

export type HedgeOutcome = "primary-won" | "hedge-won";

export interface HedgeConfig {
  afterMs: number;
  afterMsByModel: string;
  target: "same" | "next";
  /** Allowed chat models, in configuration order. */
  chatModels: readonly string[];
}

export type HedgeAttempt = { ok: true } | { ok: false; status: number };

export interface HedgeRequest<A extends HedgeAttempt> {
  model: string;
  config: HedgeConfig;
  /** Deadline of the whole request, ms (a hedge never extends it). */
  timeoutMs: number;
  /** One upstream request to `model`, aborted by any of `signals`. */
  attempt: (model: string, signals: AbortSignal[]) => Promise<A>;
  /** Takes one hedge from the app's budget; false when it is spent. */
  reserve: () => Promise<boolean>;
}

export type Hedged<A extends HedgeAttempt> = A & { hedge: HedgeOutcome | "none" | "budget" };

export interface HedgingPolicy {
  /** Delay before a duplicate request for `model`, ms (0 = never hedged). */
  delayMs(config: HedgeConfig, model: string): number;
  run<A extends HedgeAttempt>(request: HedgeRequest<A>): Promise<Hedged<A>>;
}

// ---------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------

export interface DecisionEngine {
  /** "private" for TurbineH's engine, "open" for the public fallback. */
  readonly edition: "private" | "open";
  readonly version: string;
  /** The pipeline's decider (worker). Throws when the configuration names no usable backend. */
  fromEnv(env: DeciderEnv, io: DecisionIO): Decider;
  /** Decisions taken while planning (web); null when no backend is configured (code decides). */
  forPlanning(env: DeciderEnv, io: DecisionIO): Decider | null;
  readonly hedging: HedgingPolicy;
}

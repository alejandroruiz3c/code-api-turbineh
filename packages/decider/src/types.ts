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

export type BackendId = "jev" | "open";

/** Hard limits of a decision backend. Requests are validated against them before sending. */
export interface DeciderCapabilities {
  /** Max options in a single Choice question. Jev: 255. Quyet: 10. */
  maxChoiceOptions: number;
  /** Max levels in a Score question (the API accepts 2–10). */
  maxScoreLevels: number;
  /** Approximate state budget in tokens before the backend truncates or rejects. */
  maxStateTokens: number;
}

export interface DecisionMeta {
  backend: BackendId;
  /** Versioned model id reported by the backend (log it with every decision). */
  model: string;
  latencyMs: number;
  /** Number of HTTP requests needed (1 unless a Choice had to be split hierarchically). */
  requests: number;
  usage: Usage;
  /** Set when the primary backend failed and the fallback answered. */
  fallbackFrom?: BackendId;
}

export interface Decision<Q extends Questions = Questions> {
  answers: { [K in keyof Q]: Answer };
  meta: DecisionMeta;
}

/**
 * Typed decision interface. Every decision point in the pipeline goes through it.
 *
 * Contract (see docs/DECIDER_BEST_PRACTICES.md): `ask` sends ALL questions for one state
 * in a single request; callers should pass many atomic questions rather than one complex one.
 */
export interface Decider {
  readonly id: BackendId;
  readonly capabilities: DeciderCapabilities;
  ask<Q extends Questions>(state: EntryType, questions: Q, opts?: AskOptions): Promise<Decision<Q>>;
}

export interface AskOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class DeciderValidationError extends Error {
  override name = "DeciderValidationError";
}

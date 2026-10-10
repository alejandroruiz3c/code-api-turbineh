import type { Env } from "@turbineh/shared";
import { SystemOneDecider } from "./system-one-decider.js";
import type { AskOptions, Decider, Decision, EntryType, Questions } from "./types.js";

/** Pinned Jev version: confidence thresholds are calibrated per version (docs: Models › Aliases). */
export const JEV_MODEL = "jev-1.13.0";
export const QUYET_DEFAULT_MODEL = "chinhnc/Quyet-1.0-Medium";

export function createJevDecider(apiKey: string, fetchImpl?: typeof fetch): Decider {
  return new SystemOneDecider({
    id: "jev",
    model: JEV_MODEL,
    apiKey,
    // Docs: ≤255 options per Choice, 2–10 Score levels, 32k tokens for state + longest question.
    capabilities: { maxChoiceOptions: 255, maxScoreLevels: 10, maxStateTokens: 30_000 },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/** Open alternative (Quyet behind services/open-decider) — same request shape, same SDK. */
export function createOpenDecider(
  baseURL: string,
  model: string = QUYET_DEFAULT_MODEL,
  fetchImpl?: typeof fetch,
): Decider {
  return new SystemOneDecider({
    id: "open",
    model,
    baseURL,
    apiKey: "local-open-decider",
    // Quyet README: ≤10 options (more are rejected), state truncated past 6,000 tokens.
    capabilities: { maxChoiceOptions: 10, maxScoreLevels: 10, maxStateTokens: 5_500 },
    hierarchicalChoice: true,
    timeoutMs: 60_000,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/** Routes to the primary backend and falls back on any error. Chosen by policy, never by prompt. */
export class FallbackDecider implements Decider {
  readonly id;
  readonly capabilities;

  constructor(
    private readonly primary: Decider,
    private readonly fallback: Decider,
  ) {
    this.id = primary.id;
    this.capabilities = primary.capabilities;
  }

  async ask<Q extends Questions>(
    state: EntryType,
    questions: Q,
    opts?: AskOptions,
  ): Promise<Decision<Q>> {
    try {
      return await this.primary.ask(state, questions, opts);
    } catch {
      const d = await this.fallback.ask(state, questions, opts);
      return { ...d, meta: { ...d.meta, fallbackFrom: this.primary.id } };
    }
  }
}

/** Builds the configured decider (primary + optional fallback) from validated env. */
export function deciderFromEnv(env: Env): Decider {
  const build = (id: "jev" | "open"): Decider | undefined => {
    if (id === "jev")
      return env.TYPESAFE_API_KEY ? createJevDecider(env.TYPESAFE_API_KEY) : undefined;
    return env.OPEN_DECIDER_BASE_URL ? createOpenDecider(env.OPEN_DECIDER_BASE_URL) : undefined;
  };
  const primary = build(env.DECIDER_PRIMARY);
  const fallback = env.DECIDER_FALLBACK === "none" ? undefined : build(env.DECIDER_FALLBACK);
  if (primary && fallback && primary.id !== fallback.id)
    return new FallbackDecider(primary, fallback);
  const only = primary ?? fallback;
  if (!only)
    throw new Error("no decider configured: set TYPESAFE_API_KEY or OPEN_DECIDER_BASE_URL");
  return only;
}

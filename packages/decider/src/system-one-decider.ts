import { TypeSafeClient, type ChoiceQuestion, type ChoiceResponse } from "@typesafe-ai/sdk";
import { choiceConfidence } from "./confidence.js";
import { estimateTokens, validateQuestions } from "./questions.js";
import type {
  Answer,
  AskOptions,
  BackendId,
  Decider,
  DeciderCapabilities,
  Decision,
  EntryType,
  Questions,
  Usage,
} from "./types.js";

export interface SystemOneDeciderConfig {
  id: BackendId;
  capabilities: DeciderCapabilities;
  /** Pinned, versioned model id (thresholds are calibrated per version). */
  model: string;
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  /** Split Choice questions above `maxChoiceOptions` into a two-level beam (open backends). */
  hierarchicalChoice?: boolean;
  /** Test seam. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

const GROUP_SEP = "::g";

/**
 * Decider over any `/v1/systemone`-compatible endpoint, using the official TypeSafe SDK.
 * JevDecider and OpenDecider are both instances of this class with different config.
 *
 * Best practice enforced here: one request carries every question for the state.
 */
export class SystemOneDecider implements Decider {
  readonly id: BackendId;
  readonly capabilities: DeciderCapabilities;
  readonly #client: TypeSafeClient;
  readonly #config: SystemOneDeciderConfig;

  constructor(config: SystemOneDeciderConfig) {
    this.id = config.id;
    this.capabilities = config.capabilities;
    this.#config = config;
    this.#client = new TypeSafeClient({
      apiKey: config.apiKey,
      defaultModel: config.model,
      timeout: config.timeoutMs ?? 10_000,
      logLevel: "off",
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  async ask<Q extends Questions>(
    state: EntryType,
    questions: Q,
    opts: AskOptions = {},
  ): Promise<Decision<Q>> {
    const hierarchical = this.#config.hierarchicalChoice === true;
    validateQuestions(questions, this.capabilities, { allowHierarchicalChoice: hierarchical });
    if (estimateTokens(state) > this.capabilities.maxStateTokens) {
      // Never let a backend silently truncate the state: fail loudly so the caller trims it.
      throw new RangeError(
        `state ≈${estimateTokens(state)} tokens exceeds ${this.id} budget of ${this.capabilities.maxStateTokens}`,
      );
    }

    const start = performance.now();
    const oversized = hierarchical ? this.#oversizedChoices(questions) : [];
    const stage1 = this.#stageOneQuestions(questions, oversized);
    const r1 = await this.#call(state, stage1, opts);
    let usage = r1.usage;
    let requests = 1;
    const answers: Record<string, Answer> = {};

    for (const [id, a] of Object.entries(r1.answers)) {
      if (!id.includes(GROUP_SEP)) answers[id] = normalize(a);
    }

    if (oversized.length > 0) {
      const stage2: Questions = {};
      for (const id of oversized) {
        stage2[id] = this.#finalistsQuestion(questions[id] as ChoiceQuestion, id, r1.answers);
      }
      const r2 = await this.#call(state, stage2, opts);
      requests += 1;
      usage = addUsage(usage, r2.usage);
      for (const id of oversized) {
        answers[id] = expandFinal(
          questions[id] as ChoiceQuestion,
          r2.answers[id] as ChoiceResponse,
        );
      }
    }

    return {
      answers: answers as Decision<Q>["answers"],
      meta: {
        backend: this.id,
        model: r1.model,
        latencyMs: Math.round(performance.now() - start),
        requests,
        usage,
      },
    };
  }

  async #call(state: EntryType, questions: Questions, opts: AskOptions) {
    const res = await this.#client.systemOne(
      { state, questions, model: this.#config.model },
      {
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      },
    );
    return {
      model: res.model,
      answers: res.answers as Record<string, Answer>,
      usage: res.usage,
    };
  }

  #oversizedChoices(questions: Questions): string[] {
    return Object.entries(questions)
      .filter(
        ([, q]) =>
          q.type === "choice" &&
          Object.keys(q.criteria).length > this.capabilities.maxChoiceOptions,
      )
      .map(([id]) => id);
  }

  /** Stage 1: every normal question plus one group question per chunk of each oversized Choice. */
  #stageOneQuestions(questions: Questions, oversized: string[]): Questions {
    const out: Questions = {};
    for (const [id, q] of Object.entries(questions)) {
      if (!oversized.includes(id)) {
        out[id] = q;
        continue;
      }
      const choiceQ = q as ChoiceQuestion;
      chunk(Object.entries(choiceQ.criteria), this.capabilities.maxChoiceOptions).forEach(
        (group, i) => {
          out[`${id}${GROUP_SEP}${i}`] = {
            type: "choice",
            ...(choiceQ.instructions !== undefined ? { instructions: choiceQ.instructions } : {}),
            criteria: Object.fromEntries(group),
          };
        },
      );
    }
    return out;
  }

  /** Stage 2: beam over groups — keep the top ⌊max/groups⌋ options of every group. */
  #finalistsQuestion(
    original: ChoiceQuestion,
    id: string,
    stage1: Record<string, Answer>,
  ): ChoiceQuestion {
    const groups = Object.entries(stage1).filter(([k]) => k.startsWith(`${id}${GROUP_SEP}`));
    const perGroup = Math.max(1, Math.floor(this.capabilities.maxChoiceOptions / groups.length));
    const finalists = groups.flatMap(([, a]) =>
      Object.entries((a as ChoiceResponse).probabilities)
        .sort(([, x], [, y]) => y - x)
        .slice(0, perGroup)
        .map(([label]) => label),
    );
    return {
      type: "choice",
      ...(original.instructions !== undefined ? { instructions: original.instructions } : {}),
      criteria: Object.fromEntries(
        finalists.map((label) => [label, original.criteria[label] ?? null]),
      ),
    };
  }
}

/**
 * Backends differ in how they report Choice confidence (Quyet returns p_max). Recompute it with
 * the documented TypeSafe formula so thresholds mean the same thing on every backend.
 */
function normalize(answer: Answer): Answer {
  if (answer.type !== "choice") return answer;
  return { ...answer, confidence: choiceConfidence(answer.probabilities) };
}

function expandFinal(original: ChoiceQuestion, final: ChoiceResponse): ChoiceResponse {
  const probabilities: Record<string, number> = {};
  for (const label of Object.keys(original.criteria)) {
    probabilities[label] = final.probabilities[label] ?? 0;
  }
  return {
    type: "choice",
    choice: final.choice,
    confidence: choiceConfidence(probabilities),
    probabilities,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups = Math.ceil(items.length / size);
  const even = Math.ceil(items.length / groups);
  return Array.from({ length: groups }, (_, i) => items.slice(i * even, (i + 1) * even));
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

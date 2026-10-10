import type { ChoiceQuestion, EntryType, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk";
import { DeciderValidationError, type DeciderCapabilities, type Questions } from "./types.js";

/**
 * Question builders that bake in the documented good practices:
 * - Choice adds a `none_of_the_above` option unless told otherwise, so the model can say nothing fits.
 * - Score requires situation descriptions (at least two levels), never bare numbers.
 */
export const NONE_OPTION = "none_of_the_above";

export function choice(
  instructions: EntryType,
  criteria: Record<string, EntryType>,
  opts: { includeNone?: boolean } = {},
): ChoiceQuestion {
  const withNone =
    opts.includeNone === false || NONE_OPTION in criteria
      ? criteria
      : { ...criteria, [NONE_OPTION]: "None of the other options fits." };
  return { type: "choice", instructions, criteria: withNone };
}

export function noul(
  instructions: EntryType,
  criteria?: { true?: EntryType; false?: EntryType },
): NoulQuestion {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

export function score(
  instructions: EntryType,
  levels: readonly [EntryType, EntryType, ...EntryType[]],
): ScoreQuestion {
  return { type: "score", instructions, criteria: levels };
}

/** Rough token estimate (≈4 chars per token) used only for budget checks. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(text.length / 4);
}

/** Validates a question map against backend limits before any network call. */
export function validateQuestions(
  questions: Questions,
  caps: DeciderCapabilities,
  opts: { allowHierarchicalChoice?: boolean } = {},
): void {
  const ids = Object.keys(questions);
  if (ids.length === 0) throw new DeciderValidationError("at least one question is required");
  for (const id of ids) {
    const q = questions[id];
    if (!q) continue;
    if (q.type === "choice") {
      const n = Object.keys(q.criteria).length;
      if (n < 2) throw new DeciderValidationError(`choice "${id}" needs at least 2 options`);
      const limit = opts.allowHierarchicalChoice
        ? caps.maxChoiceOptions ** 2
        : caps.maxChoiceOptions;
      if (n > limit) {
        throw new DeciderValidationError(
          `choice "${id}" has ${n} options; backend limit is ${limit}`,
        );
      }
    } else if (q.type === "score") {
      const n = q.criteria.length;
      if (n < 2 || n > caps.maxScoreLevels) {
        throw new DeciderValidationError(
          `score "${id}" has ${n} levels; expected 2–${caps.maxScoreLevels}`,
        );
      }
    }
  }
}

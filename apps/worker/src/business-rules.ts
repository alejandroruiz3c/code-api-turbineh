import { choice, noul, score, type Answer, type Decider, type Questions } from "@turbineh/decider";

/**
 * Trigger T3 (PLAN §2.4, ADR-0020): business rules in the request that the recipe does not cover. The decider answers
 * atomic questions per acceptance criterion in ONE batched request; this code applies fixed thresholds. A model never
 * decides whether a rule is implemented correctly: that is what the rule's tests and the full verification do.
 */
export const T3_POLICY = {
  /** p that the criterion is a rule that rejects some records when they are created. */
  isRule: 0.7,
  /** p that the recipe already does it (above this, it is the recipe's job, not T3). */
  covered: 0.5,
  /** Confidence of the entity choice. */
  entity: 0.5,
  /** Expected complexity on the 0–3 rubric: from "a check on the submitted values" to "same-kind records". */
  complexity: { min: 0.75, max: 2.5 },
  /** Bounded Backup Coder usage per build. */
  maxRules: 3,
} as const;

export const COMPLEXITY_LEVELS = [
  "Nothing to code beyond the generated form: a page, a list, a role permission, a required field or a field type.",
  "A check on the values of the record being created (a range, a format, one field compared with another).",
  "A check against other records of the same kind in the workspace (uniqueness, a limit per person, no overlaps).",
  "Needs other kinds of records, external services, payments, emails, schedules or background jobs.",
] as const;

export interface RuleCandidate {
  criterion: string;
  isRule: number;
  covered: number;
  entity: string | null;
  entityConfidence: number;
  complexity: number;
  selected: boolean;
  reason: string;
}

const NONE = "none_of_the_above";

/** One batched decider request: four atomic questions per acceptance criterion. */
export function ruleQuestions(criteria: string[], entities: string[]): Questions {
  const q: Questions = {};
  criteria.forEach((_, i) => {
    q[`rule:${i}`] = noul(
      `\`criteria.c${i}\` is a business rule that makes the app reject some records when they are created ` +
        "(for example a limit, a uniqueness or no-overlap condition, or an allowed range of values).",
    );
    q[`covered:${i}`] = noul(
      `The rule in \`criteria.c${i}\` is already part of \`app.recipe\` as described there.`,
    );
    q[`entity:${i}`] = choice(
      `Which data entity in \`entities\` does \`criteria.c${i}\` restrict when a record is created?`,
      Object.fromEntries(entities.map((e) => [e, null])),
    );
    q[`complexity:${i}`] = score(
      `How much code does \`criteria.c${i}\` need beyond the generated create form?`,
      COMPLEXITY_LEVELS,
    );
  });
  return q;
}

/** Deterministic policy over the decider's answers (thresholds above; first criteria first; capped). */
export function selectRules(
  criteria: string[],
  answers: Record<string, Answer | undefined>,
): RuleCandidate[] {
  let taken = 0;
  return criteria.map((criterion, i) => {
    const p = (k: string) => {
      const a = answers[`${k}:${i}`];
      return a?.type === "noul" ? a.noul : 0;
    };
    const e = answers[`entity:${i}`];
    const entity = e?.type === "choice" && e.choice !== NONE ? e.choice : null;
    const entityConfidence = e?.type === "choice" ? e.confidence : 0;
    const k = answers[`complexity:${i}`];
    const complexity = k?.type === "score" ? k.score : 0;
    const c = {
      criterion,
      isRule: p("rule"),
      covered: p("covered"),
      entity,
      entityConfidence,
      complexity,
    };
    const reason =
      c.isRule < T3_POLICY.isRule
        ? "not a business rule"
        : c.covered >= T3_POLICY.covered
          ? "already part of the recipe"
          : !entity || entityConfidence < T3_POLICY.entity
            ? "no generated entity it applies to"
            : complexity < T3_POLICY.complexity.min
              ? "covered by the generated form"
              : complexity > T3_POLICY.complexity.max
                ? "needs more than one kind of record or an external service"
                : taken >= T3_POLICY.maxRules
                  ? "over the per-build limit"
                  : "selected";
    const selected = reason === "selected";
    if (selected) taken++;
    return { ...c, selected, reason };
  });
}

/** Asks the decider and applies the policy. Errors mean no T3 (the build goes on with the recipe's behaviour). */
export async function decideRules(
  input: {
    summary: string;
    recipe: string;
    criteria: string[];
    entities: Record<string, string[]>;
  },
  decider: Decider,
): Promise<RuleCandidate[]> {
  const names = Object.keys(input.entities);
  if (input.criteria.length === 0 || names.length === 0) return [];
  const d = await decider.ask(
    {
      app: { summary: input.summary, recipe: input.recipe },
      criteria: Object.fromEntries(input.criteria.map((c, i) => [`c${i}`, c])),
      entities: input.entities,
    },
    ruleQuestions(input.criteria, names),
  );
  return selectRules(input.criteria, d.answers as Record<string, Answer | undefined>);
}

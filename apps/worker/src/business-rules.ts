import { choice, noul, score, type Answer, type Decider, type Questions } from "@turbineh/decider";

/**
 * Trigger T3 (PLAN §2.4, ADR-0023, ADR-0026): business rules in the request that the recipe does not cover. The
 * decider answers atomic questions per acceptance criterion in ONE batched request; this code applies fixed
 * thresholds. A model never decides whether a rule is implemented correctly: that is what the rule's tests and the
 * full verification do.
 */
export const T3_POLICY = {
  /** p that the criterion is a rule that rejects some records when they are created or changed. */
  isRule: 0.7,
  /** p that the recipe already does it (above this, it is the recipe's job, not T3). */
  covered: 0.5,
  /** p that checking the rule needs records of another kind (another entity, users, members, roles). */
  otherRecords: 0.5,
  /** Confidence of the entity choice. */
  entity: 0.5,
  /** Confidence of the related-entity choice. */
  related: 0.5,
  /** Related entities a rule may read (each through its own read-only loader). */
  maxRelated: 2,
  /** Confidence of the create/update choice; below it the rule applies to both. */
  operation: 0.5,
  /** Expected complexity on the 0–3 rubric: from "a check on the submitted values" to "other entities it refers to". */
  complexity: { min: 0.75, max: 2.5 },
  /** Bounded Backup Coder usage per build. */
  maxRules: 3,
} as const;

export const COMPLEXITY_LEVELS = [
  "Nothing to code beyond the generated form: a page, a list, a role permission, a required field or a field type.",
  "A check on the values of the record being created or changed (a range, a format, one field compared with another).",
  "A check against other records of the same kind, or against the records of another entity of this app that it " +
    "refers to (uniqueness, a limit per person, no overlaps, the referenced record exists, a capacity).",
  "Needs users, team members, roles, external services, payments, emails, schedules or background jobs.",
] as const;

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

const NONE = "none_of_the_above";
const WHEN = { create: null, update: null, both: null };

/** One batched decider request: seven atomic questions per acceptance criterion. */
export function ruleQuestions(criteria: string[], entities: string[]): Questions {
  const q: Questions = {};
  const options = Object.fromEntries(entities.map((e) => [e, null]));
  criteria.forEach((_, i) => {
    q[`rule:${i}`] = noul(
      `\`criteria.c${i}\` is a business rule that makes the app reject some records when they are created or ` +
        "changed (for example a limit, a uniqueness or no-overlap condition, an allowed range of values, or a " +
        "referenced record that must exist).",
    );
    q[`covered:${i}`] = noul(
      `The rule in \`criteria.c${i}\` is already part of \`app.recipe\` as described there.`,
    );
    q[`other:${i}`] = noul(
      `Checking \`criteria.c${i}\` needs records of a different kind than the one it restricts (for example ` +
        "another entity, users, team members or roles), not only the record itself and others like it.",
    );
    q[`entity:${i}`] = choice(
      `Which data entity in \`entities\` does \`criteria.c${i}\` restrict when a record is created or changed?`,
      options,
    );
    q[`related:${i}`] = choice(
      `Which other data entity in \`entities\` must be read to check \`criteria.c${i}\` (none if only the ` +
        "restricted entity itself is needed)?",
      options,
    );
    q[`when:${i}`] = choice(
      `When does \`criteria.c${i}\` apply: when a record is created, when an existing record is changed, or both?`,
      WHEN,
    );
    q[`complexity:${i}`] = score(
      `How much code does \`criteria.c${i}\` need beyond the generated create and edit forms?`,
      COMPLEXITY_LEVELS,
    );
  });
  return q;
}

/**
 * Deterministic policy over the decider's answers (thresholds above; first criteria first; capped). `links` maps each
 * generated entity to the generated entities it references through reference fields: a rule that needs other records
 * is implemented only when those records belong to such linked entities (read through code-written loaders).
 */
export function selectRules(
  criteria: string[],
  answers: Record<string, Answer | undefined>,
  entities: string[] = [],
  links: Record<string, string[]> = {},
): RuleCandidate[] {
  let taken = 0;
  return criteria.map((criterion, i) => {
    const p = (k: string) => {
      const a = answers[`${k}:${i}`];
      return a?.type === "noul" ? a.noul : 0;
    };
    const pick = (k: string): { value: string | null; confidence: number } => {
      const a = answers[`${k}:${i}`];
      return a?.type === "choice"
        ? { value: a.choice === NONE ? null : a.choice, confidence: a.confidence }
        : { value: null, confidence: 0 };
    };
    const e = pick("entity");
    const entity = e.value;
    const k = answers[`complexity:${i}`];
    const complexity = k?.type === "score" ? k.score : 0;
    const when = pick("when");
    const operations: Operation[] =
      when.confidence >= T3_POLICY.operation && when.value === "create"
        ? ["create"]
        : when.confidence >= T3_POLICY.operation && when.value === "update"
          ? ["update"]
          : ["create", "update"];

    // Other records: the decider's related-entity choice when it is confident (including a confident "none", e.g.
    // "users with the teacher role"); otherwise the generated entities named in the rule text (deterministic).
    const r = pick("related");
    const confident = r.confidence >= T3_POLICY.related;
    const wanted = confident
      ? r.value && r.value !== entity
        ? [r.value]
        : []
      : mentionedEntities(criterion, entity, entities);
    const needsOther = p("other") >= T3_POLICY.otherRecords || wanted.length > 0;
    const linked = entity ? (links[entity] ?? []) : [];
    const related = wanted.filter((x) => linked.includes(x)).slice(0, T3_POLICY.maxRelated);

    const c = {
      criterion,
      isRule: p("rule"),
      covered: p("covered"),
      entity,
      entityConfidence: e.confidence,
      complexity,
      operations,
      related: needsOther ? related : [],
    };
    const reason =
      c.isRule < T3_POLICY.isRule
        ? "not a business rule"
        : c.covered >= T3_POLICY.covered
          ? "already part of the recipe"
          : !entity || e.confidence < T3_POLICY.entity
            ? "no generated entity it applies to"
            : complexity < T3_POLICY.complexity.min
              ? "covered by the generated form"
              : complexity > T3_POLICY.complexity.max
                ? "needs users, roles or an external service"
                : needsOther && related.length === 0
                  ? "needs records it is not linked to (users, roles, or an entity without a reference field)"
                  : taken >= T3_POLICY.maxRules
                    ? "over the per-build limit"
                    : "selected";
    const selected = reason === "selected";
    if (selected) taken++;
    return { ...c, selected, reason };
  });
}

/** Deterministic: the generated entities (other than the restricted one) named in the rule text. */
export function mentionedEntities(
  criterion: string,
  entity: string | null,
  entities: string[],
): string[] {
  const text = ` ${criterion.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const words = (name: string) =>
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .trim();
  return entities
    .filter((e) => e !== entity)
    .filter((e) => {
      const w = words(e);
      return [w, `${w}s`, `${w}es`, w.replace(/y$/, "ies")].some((f) => text.includes(` ${f} `));
    });
}

/** Asks the decider and applies the policy. Errors mean no T3 (the build goes on with the recipe's behaviour). */
export async function decideRules(
  input: {
    summary: string;
    recipe: string;
    criteria: string[];
    entities: Record<string, string[]>;
    links: Record<string, string[]>;
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
  return selectRules(
    input.criteria,
    d.answers as Record<string, Answer | undefined>,
    names,
    input.links,
  );
}

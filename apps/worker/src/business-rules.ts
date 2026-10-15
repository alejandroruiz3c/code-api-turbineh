import type { Decider, Operation, RuleCandidate, RulesInput } from "@turbineh/decider";

/**
 * Trigger T3 (PLAN §2.4, ADR-0023, ADR-0026): business rules in the request that the recipe does not cover. Which
 * acceptance criteria are rules worth T3 code, on which entity, when and with which related records is a resource
 * decision (ADR-0058): the engine answers, this code writes and verifies. A model never decides whether a rule is
 * implemented correctly: that is what the rule's tests and the full verification do.
 */
export type { Operation, RuleCandidate };

/** Reasons that mean the rule is enforced without T3 code (the recipe, or the generated form's validation). */
const COVERED = new Set(["already part of the recipe", "covered by the generated form"]);

/**
 * Rules of the request that no code implements (ADR-0054), for the report: a rule is code (written by T3), covered by
 * the recipe or the generated form, or listed here — a limitation (not chosen, with why) or blocked (chosen, but
 * not written). Deterministic; criteria the decider did not take for rules are not rules.
 */
export function rulesWithoutCode(
  candidates: readonly RuleCandidate[],
  written: readonly string[],
): { criterion: string; entity: string | null; reason: string; blocked: boolean }[] {
  const done = new Set(written);
  return candidates
    .filter((c) => c.reason !== "not a business rule" && !COVERED.has(c.reason))
    .filter((c) => !done.has(c.criterion))
    .map((c) => ({
      criterion: c.criterion,
      entity: c.entity,
      reason: c.selected ? "the backup code model could not write it safely" : c.reason,
      blocked: c.selected,
    }));
}

/** Asks the decision engine. Errors mean no T3 (the build goes on with the recipe's behaviour). */
export function decideRules(
  input: RulesInput,
  decider: Pick<Decider, "businessRules">,
): Promise<RuleCandidate[]> {
  if (input.criteria.length === 0 || Object.keys(input.entities).length === 0)
    return Promise.resolve([]);
  return decider.businessRules(input);
}

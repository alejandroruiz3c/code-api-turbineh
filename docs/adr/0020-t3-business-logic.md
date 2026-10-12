# ADR-0020 · Backup Coder trigger T3: business rules from the request, implemented and verified

- Status: accepted (owner request, 2026-10-12)
- Date: 2026-10-12
- Related: PLAN §2.4 (T1–T6), ADR-0003 (Backup Coder), ADR-0010 (small calls), WP10 corrector

## Context

Prompts often contain business rules ("a member cannot have two active memberships", "at most 2 open loans per
borrower"). The recipes generate typed create forms per entity, but such rules stayed as acceptance criteria that no
check demonstrated ("Not verified automatically" in the report). PLAN §2.4 reserves trigger T3 for high-complexity glue
decided by the decider's complexity score and a threshold.

## Decision

1. **Hook in every generated entity (code, not model).** The assembler writes `src/entities/<entity>/rules.ts` with
   `check<Entity>Rules: EntityRules<Input, Row>` (stub: always accepts). The generated server actions call it before
   `create` and for every CSV-imported row (checked against the workspace and the rows accepted before it). The rule
   receives `ctx.existing()`: same-workspace rows of that entity, newest first, bounded (`RULES_SCAN_LIMIT`), loaded only
   when a rule asks. A violation is shown to the user through `UserFacingError`.
2. **Decision (decider + fixed thresholds).** One batched decider request, four atomic questions per acceptance
   criterion: is it a rule that rejects records (Noul), is it already part of the recipe (Noul), which generated entity
   it restricts (Choice), complexity on a 0–3 rubric (Score). Code selects a rule when `isRule ≥ 0.7`, `covered < 0.5`,
   entity confidence `≥ 0.5` and expected complexity in `[0.75, 2.5]` (a check on the submitted values, or against
   records of the same kind). Level 3 (other kinds of records, external services, jobs) is out of scope for T3 and stays
   reported. At most **3 rules per build**. Rules on recipe-provided entities remain the recipe's job.
3. **Generation (Backup Coder, minimal context).** Per entity, two calls (module, then its test against the module)
   with only the rule texts, the entity's schema and table files, the hook contract and the app's own E2E samples.
   Output carries `// turbineh:generated-backup trigger=T3`, passes the pre-commit secret barrier (`leakingFiles`) and is
   recorded in `catalog/gaps/` (flywheel). Runs in parallel with external integration; files are written after it.
4. **Oracle written by code.** `tests/unit/rules/<entity>.fixtures.test.ts` asserts that the rules accept the app's own
   end-to-end samples (created record; imported record next to it). The E2E samples were made rule-friendly: later date
   fields get later dates, and the imported row differs in every text-like field. The corrector may edit the rules
   module and the model-written test, never the fixture test.
5. **Never ship red.** Same verification as the rest of the app; corrector (patch → quick check, max 3). If the build is
   still red, the rules parts are removed first (the module goes back to the stub; tests are deleted), even when the log
   does not name them (behaviour changes can surface only in E2E), before any full swap. The report then marks the rule
   as not implemented and adds a next step.
6. **Report and metrics.** `TURBINEH_REPORT.md` lists each rule with its module and tests (or "not implemented"); rule
   tests are evidence for the criteria mapping. Metrics record T3 as Backup Coder activations (`trigger: "T3"`, usage,
   kept), so cost and the benchmark (`businessRules.written/kept`) count them.

## Consequences

- Rules that fit the hook are implemented and demonstrated by tests instead of being left as criteria.
- Extra cost per build with rules: one decider request (input-only) and two small Backup Coder calls per entity.
- Not covered: rules spanning several entities, updates (generated entities have create/delete only), time-based or
  external rules, and rules on recipe-provided entities. They are reported as before.
- No AI inside client apps (beta rule): rules are plain deterministic TypeScript. The Security Pack is unchanged.

# Decider best practices (JEV and open alternative)

Every module that talks to a decider follows these rules. Most are enforced by `packages/decider`.
Sources: TypeSafe docs (docs.typesafe.ai — fan-out, how-to-build, confidence, primitives, models, Jev 1.13
jaggedness, hierarchical classification cookbook) and the Quyet README.

## Project principle

See [ADR-0010](adr/0010-decomposition-principle.md): decomposed, simple content and simple tools over complex tasks — for every model.

## Request structure

- **All questions for one state go in one request**, including speculative ones; discard unneeded answers in code.
  Batching does not change answers and pays the state once (docs: _Speculative fan-out_, _Parallel questions_).
- **Many atomic questions beat one complex question.** One property per question; a Noul with "A and B" is two
  Nouls combined in code (docs: _Decompose the questions_).
- Split a request only when the context budget is exceeded (Jev: 64k state + all questions; 32k state + longest
  question). When splitting, resend the same state and merge answers by id.

## State

- Structured JSON with named fields; questions reference fields with backticks (`` `build_spec.capability` ``).
- Send only what the questions need. Accuracy drops with large, noisy states. Filter in code first.
- Text only. Arithmetic, counting and date comparison are done in code, not by the decider.
- Open backend (Quyet): state ≤ ~6,000 tokens. The decider refuses larger states instead of letting the model
  truncate silently.

## Instructions and criteria

- Option names **and** descriptions reach the model; question ids do not. Descriptions must separate options.
- Add `none_of_the_above` when the list may not cover every input (default in `choice()`).
- For confusable options use structured criteria with the same fields for every option
  (`what`, `not_for`, `examples`).
- Noul: phrase so that a high value means "yes"; avoid negations. Score: describe situations per level, one dimension.
- Write instructions in English (primary training language of both backends).

## Types

- Noul → yes/no probability (not a degree). Choice → unordered closed set (Jev ≤ 255 options, Quyet ≤ 10).
  Score → ordered 2–10 levels.

## Confidence and routing

- Choice confidence = (p_max − 1/n)/(1 − 1/n), recomputed on every backend. Noul: |2p − 1|.
- Three bands per action — act / review / escalate — configured per decision point, never a global threshold.
  Calibrate on our own data; start conservative.
- Pin `jev-1.13.0`; log `model` and `usage` of every response.

## Many options

- Open backend: Choices above 10 options are split automatically into a two-level beam (all groups batched in
  one request, then finalists). For deep taxonomies use chained Choices with beam search (cookbook: hierarchical
  classification).

## Known weak spots (Jev 1.13 jaggedness)

Arithmetic/counting, dates, raw numeric codes, indirection and double negation, large noisy states, adversarial
text in the state, contradictory criteria, and a bias toward the first Choice option (shuffle-check important
decisions). Non-English content is less accurate.

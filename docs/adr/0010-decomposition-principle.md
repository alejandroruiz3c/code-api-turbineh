# ADR-0010 · Decomposition principle: simple pieces over complex tasks

- Status: accepted (owner principle, 2026-10-10)
- Date: 2026-10-10

## Principle

Every model in the system performs better and degrades less with **decomposed, simple content and simple tools**
than with one complex question, task or tool. This applies to the decider, the compiler, the Backup Coder and
any future agent.

## Rules

1. **Classify with the decider, not with a generator.** Anything that is a choice (recipe, capability present,
   risk, fit) is an atomic decider question; all questions for one state go in one batched request.
2. **Generate in small bounded parts.** A generator never produces a large document in one call: it produces
   small structured parts with tiny schemas (bounded arrays and lengths), in parallel, assembled by code.
3. **Code assembles and validates.** Joining parts, always-on defaults, deduplication and final validation are
   deterministic.
4. **Simple tools.** Each tool does one thing with a small input/output contract; compose tools in code.
5. **Bound every generation** (max items, max tokens, no thinking where not needed) so a degenerate output fails
   fast instead of running for minutes.

## Evidence (D0 smoke, `bench/results/2026-10-10-d0-smoke/`)

The monolithic BuildSpec schema failed 5/5 on the production provider (constrained decoding looped until the token
cap). The decomposed compiler (decider batch + four small parts) produced 5/5 valid BuildSpecs on the first attempt.
Exact timings and token counts are in the bench files.

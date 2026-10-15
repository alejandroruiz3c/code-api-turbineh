# ADR-0009 · Benchmark baseline: closed frontier agent (measurement only)

- Status: accepted by the owner (2026-10-10)
- Date: 2026-10-10
- Context: PLAN §12; model policy in ADR-0001 (open-weights only, except JEV)

## Decision

The benchmark baseline is a **conventional full-generation coding agent running a top closed frontier model**
(default: Claude Code headless with Claude Opus 5.5; recorded per run: agent, model id, version, settings).
This is the comparison users recognise, so it is the fair and credible reference.

## Scope of the exception

- Allowed **only** in `bench/` to produce the baseline. The product pipeline never calls closed models.
- Baseline outputs are never used to train, distil or fine-tune any model, nor copied into the catalog
  (provider terms forbid training on outputs).
- Same prompts, same acceptance criteria and the same verification gate as our pipeline; tokens, cost, time to
  green repo and corrections are recorded for both.
- Spend is covered by the "Benchmark baseline" line of ADR-0008.

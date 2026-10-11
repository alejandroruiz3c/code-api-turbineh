# Benchmark baseline (ADR-0009)

The baseline is a conventional full-generation coding agent with a closed frontier model: **Claude Code headless
with Claude Opus 5.5**, used only here, never in the product pipeline.

## Status

Not run yet: it needs an Anthropic API key for the benchmark (decision and budget line in ADR-0008/0009). No such
key is configured.

## Procedure (same prompts, same gate)

1. For each `bench/prompts/*.json`, run the agent **inside an ephemeral container** (never on the host: it installs
   and builds third-party code) with only `ANTHROPIC_API_KEY`, the prompt and this contract appended:
   "Next.js + TypeScript app with pnpm, a committed `pnpm-lock.yaml` and the scripts `lint`, `typecheck`, `test`,
   `build`, `test:e2e`, `db:generate`, `db:migrate` (Postgres via `DATABASE_URL`)."
2. Record per run: agent and model id/version, settings, wall time, input/output tokens and cost reported by the
   agent, number of turns.
3. Verify the produced repository with the same gate as our builds (`verify()` from `@turbineh/verifier`: sandbox
   without internet, lint, typecheck, unit, build, E2E, gitleaks, Semgrep, OSV, licenses).
4. Compare with `bench/results/*-benchmark.json`: green repo yes/no, acceptance criteria met, time to green repo,
   security findings, tokens and cost. Only numbers measured this way are published.

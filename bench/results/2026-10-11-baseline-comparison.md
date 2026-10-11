# Baseline comparison · 2026-10-11 (ADR-0009)

**Question:** for the same prompt, what does a conventional full-generation coding agent with a top closed model
deliver, compared with CODE-API-TURBINEH — through the **same verification gate**?

## Method (representative sample, time-boxed to one hour)

- **Sample:** one prompt per recipe family, 4 of 5 (`saas-01`, `landing-01`, `bookings-01`, `portal-01`).
  `internal-tool` is left out because it extends `saas-crud` and is the closest to it.
- **Baseline:** Claude Code 2.1.283 headless, model `claude-opus-5-5`, inside an ephemeral container with the same
  toolchain as our sandbox (Node, pnpm 10.33, Playwright 1.63), only `ANTHROPIC_API_KEY` as secret. Same prompt plus
  the same delivery contract (Next.js, TypeScript strict, Postgres, scripts for lint/typecheck/test/build/E2E/migrations).
  `saas-01` ran without limits; the other three ran in parallel, time-boxed (38 min hard limit, 60 turns) to deliver
  results within one hour.
- **Ours:** staging run of the same prompts ([2026-10-11-18-03-benchmark.md](2026-10-11-18-03-benchmark.md)).
- **Gate:** both repositories through the same `verify()`: sandbox without internet, lint, strict typecheck, unit,
  production build, E2E on an ephemeral Postgres, gitleaks, Semgrep with TurbineH rules, OSV, licences. Baseline outputs
  were re-verified after fixing two TurbineH Semgrep rules that only recognised our own helpers
  ([reverify](2026-10-11-baseline-reverify.json)).

## Results

| Prompt | Ours: verified | Ours: time | Ours: tracked model cost | Baseline: verified | Baseline: agent time | Baseline: cost |
|---|---|---|---|---|---|---|
| saas-01 | ✅ | 116 s | €0.0016 | ❌ licences | 2,450 s (46 turns) | $2.63 |
| landing-01 | ✅ | 118 s | €0.0006 | ❌ licences + 1 public action not annotated | 346 s (25 turns) | $0.94 |
| bookings-01 | ✅ | 137 s | €0.0040 | ❌ licences + 3 public auth actions not annotated | 430 s (27 turns) | $1.26 |
| portal-01 | ✅ | 67 s | €0.0008 | ❌ licences + 1 public action not annotated | 406 s (26 turns) | $1.05 |
| **Total** | **4/4** | **avg 110 s** | **€0.007** | **0/4** | **avg 908 s** | **$5.88** |

What the baseline did well: **every functional check passed in all four** (lint, typecheck, unit tests, build, E2E),
and no real code vulnerability was found by our rules.

Why it is not delivered green by our gate:

1. **Licences (4/4):** Next.js image optimisation pulls `sharp` with **libvips (LGPL-3.0)**, blocked by our licence
   policy. Our recipes remove it on purpose.
2. **Known vulnerability left in production dependencies (4/4):** `esbuild@0.18.20` (moderate) — our pipeline pins
   the patched version before delivery; the baseline ships it.
3. **Public server actions without an explicit decision (3/4):** sign-up, sign-in, sign-out and waitlist actions are
   public by design; our gate requires them to be marked as such (as our own code does). Not a vulnerability, but
   counted as a failed check by the same gate.

## Limits of this comparison (read before quoting it)

- Small sample (4 prompts). Times are measured on different machines: ours on the staging worker (4 vCPU), baseline
  agent time on a local container; baseline verification time is not included in its time.
- Costs: ours = tracked open-model tokens at Scaleway list prices [est.] (not JEV, report writer, security fixer or
  compute); baseline = cost reported by the agent (USD).
- Acceptance criteria are not compared: each system derives its own from the prompt.
- The three time-boxed baseline runs were told they had ~33 minutes; they finished in 6–7 minutes.

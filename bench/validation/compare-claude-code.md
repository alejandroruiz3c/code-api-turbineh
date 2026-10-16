# Comparison with Claude Code (audit report v2, section 11.3) — prepared, not run

**Question:** on the same 30 statements of the go-validation benchmark (`statements.json`, bands A/B/C), does YES IF
beat a general coding agent with a frontier model, configured the way a competent team would configure it, on false
"verified", verified functional coverage and security? Section 11.3's investment criterion: YES IF must win by a clear
margin on those three; otherwise it adds little over the alternative the customer already has.

## Configurations

|     | Agent                              | Model                                                                      | Configuration                              |
| --- | ---------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| (a) | YES IF (public API)                | as shipped                                                                 | `run.ts --env production --yes-production` |
| (b) | Claude Code headless (`claude -p`) | Opus 5.5 (`claude-opus-5-5`)                                               | standard CLAUDE.md below + same CI         |
| (c) | Claude Code headless               | Fable 5.1 (model id set in `COMPARE_MODEL_FABLE` when the run is approved) | same as (b)                                |

Standard CLAUDE.md (written into each empty work folder; full text in `compare-claude-code.ts`, `CLAUDE_MD`):
"one test per criterion; do not declare done without a test", plus: list the criteria first, never fake an external
integration (list it under `notImplemented`; set `refused` when the core depends on it), and finish with a
`STATUS.json` that mirrors the facts YES IF puts in `turbineh.json`.

Same open-source CI for everyone: `verify()` from `@turbineh/verifier` — sandbox without internet, ESLint,
TypeScript strict, Vitest, production build, Playwright E2E on an ephemeral Postgres, gitleaks, Semgrep OSS, OSV and
licences (the tools listed in the audit's section 11.1). Agents run in the `bench/baseline` container (never on the
host) with only `ANTHROPIC_API_KEY`; outputs stay in `builds/compare/` (git-ignored).

## Scoring (identical to YES IF)

`compare-claude-code.ts` converts each agent result into the same `StatementRun` record that `run.ts` writes, so
`report.ts --run <run>` applies the same functions (`metrics.ts`):

- `refused: true` → a refusal before generating (`use_case_not_covered`); `notImplemented` → requirements removed
  explicitly (warned); the agent's criteria → derived criteria. A criterion counts as **met only if the agent marks it
  met and the shared gate passes** — the agent's word alone is not a passing test.
- Functional coverage uses the same canonical requirements and the same human review (`review.json`) for all three.
- False "verified": the gate passed (the agent's equivalent of "verified") with reviewer coverage < 80 %.
- Security: the gate's findings (Semgrep, OSV, secrets, licences) per repository, as in `bench/baseline`.
- Not comparable and reported as such: contradictions between surfaces (Claude Code has one surface), Discover,
  snippets, plan estimates.

## Cost and time expectations (from `bench/` only)

The only measured reference is `bench/results/2026-10-11-baseline-comparison.md`: Claude Code 2.1.283 + Opus 5.5, 4
prompts, same container and gate — **$0.94–2.63 per prompt ($5.88 for 4) and 346–2,450 s of agent time (avg 908 s,
25–46 turns)**, verification time excluded. Extrapolating that sample (not a measurement):

- (b) 30 statements: roughly $28–79 in API cost, about 7.5 h of agent time in total, about 2.5–3 h wall with 3 in
  parallel, plus the gate (several minutes per repository).
- (c) Fable 5.1: no measurement in `bench/` yet; run 3 statements (one per band) first and extrapolate from those.
- Band C may be cheaper if the agent refuses early, or the most expensive if it builds mocked integrations.
- Docker with 6 GB and 4 CPUs per agent; 3 in parallel needs ~18 GB of RAM.

## Before running (decisions for the owner)

1. Approve the spend (closed-model inference has relevant cost: CLAUDE.md, "Decisiones que no tomas tú").
2. Set the Fable 5.1 model id (`COMPARE_MODEL_FABLE`); confirm the Claude Code version to pin in the container.
3. Run (a) first, after the W1–W4/W6 fixes are deployed, so the three configurations use the same statement set.
4. The person reviewing coverage must not know which configuration produced each run (blind review: rename the run
   folders before handing them over).

```bash
tsx bench/validation/compare-claude-code.ts --config opus --only A01,B01,C01             # plan only
tsx bench/validation/compare-claude-code.ts --config opus --execute --parallel 3          # (b)
COMPARE_MODEL_FABLE=<id> tsx bench/validation/compare-claude-code.ts --config fable --execute   # (c)
tsx bench/validation/report.ts --run <run>   # → runs/<run>/RESULTS.md (YES IF runs write bench/validation/RESULTS.md)
```

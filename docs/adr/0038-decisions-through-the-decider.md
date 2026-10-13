# ADR-0038 · Decisions through the decider

- Status: accepted
- Date: 2026-10-13
- Numbering: 0037 is taken by the open PR #84 (robust builds); this ADR uses the next free number after it.
- Context: owner direction — prioritise TurbineH orchestration with the decider (JEV primary, open decider fallback)
  wherever it is coherent, because a calibrated Choice is cheaper and faster than asking a chat model to decide, and
  use it only where it makes sense. Audit of every model call on `main`: [`docs/decisions-audit.md`](../decisions-audit.md).
  A coordinator finding from production build `f195341c` (criteria marked "met" by tests that do not prove them) is
  handled here as well (§4), since criterion → test matching is one of the decisions audited.

## Decision

### 1 · The rule

| What                                                                                                                                                                                      | Who decides                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) A choice among discrete options** that code cannot settle from facts: which tool or route, which test proves a criterion, which app of a monorepo, whether a finding needs a person | **The decider** (`Decider` in the worker: JEV primary, open decider fallback; the TurbineH AI gateway in generated apps), thresholds in code |
| **(b) Generation** of code or text: glue, adapters, corrections, BuildSpec parts, report narrative, tool arguments, replies                                                               | **Open models** (compiler model, Backup Coder slots, GLM-5.2 for adaptation, the app's route)                                                |
| **(c) Deterministic** questions: version and database compatibility, licences, permissions, confirmations, test results, fixed policies                                                   | **Code**, never a model                                                                                                                      |

A decision moves to the decider only when it is measured equal or better on accuracy **and** better on latency or
cost than what runs today; otherwise it stays and the reason is recorded here.

### 2 · runAgent (component `ai.orchestrator.turbineh` 0.3.0): the turn's first action is a decider Choice

- The request runAgent already sent to the decider every turn (route + unsafe) now also carries `next`: one Choice
  over `reply` and every tool offered (irreversible tools are marked as confirmed by the person). Same single request,
  same number of decider calls as before.
- At confidence ≥ 0.5 (`NEXT_ACTION_THRESHOLD`, code) the open model writes only that: the chosen tool's arguments
  (only that tool is offered, `tool_choice` forces it) or the reply (no tools offered). Below the threshold, after a
  tool result, after a confirmed action and without a decider, the model sees every tool and chooses itself, as
  before. Confirmations stay deterministic code (`readConfirmation`, the confirm button).
- **Not adopted: a decider request at every step** (after each tool result). Measured equal accuracy but +24 % cost
  and +26 % mean latency per turn (79 decider calls instead of 41 on 20 conversations): reverted.
- **Gateway fix (prerequisite).** The TurbineH AI gateway (`apps/web/src/server/ai-gateway.ts`) dropped `tools`,
  `tool_choice` and the tool-call turns, so runAgent never called a tool through it (it answered from the model's
  imagination): 6/20 correct first actions on staging before the fix. It now forwards them, validated and bounded
  (≤ 32 tools, ≤ 8 calls per message, names `[A-Za-z0-9_-]{1,64}`).

### 3 · GitHub integration adaptation: stays in code

The adaptation decisions (ADR-0034) are made by `analysisFindings` / `pickAppPath` from the analysed repository; GLM-5.2
keeps writing the adapters. Measured on 20 labelled repositories (code vs one batched decider request per repository):

| Decision                | Code (today) | Decider (JEV) | Verdict                                                                                                                                                                                                                                  |
| ----------------------- | ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database strategy       | 18/20 ¹      | 13/20         | Type (c): it is database compatibility and a fixed policy. The decider called MySQL and MongoDB usable. Stays code                                                                                                                       |
| Authentication strategy | 17/20 ¹      | 18/20         | Type (c): fixed policy (never two auth systems). Stays code                                                                                                                                                                              |
| App of a monorepo       | 17/20        | 20/20         | Type (a). The decider is right on the 3 ambiguous monorepos where the heuristic picks the marketing site, but it adds ~0.1 s and ~$0.0003 per repository versus 0 for code: by the rule it is **not moved**. Escalated to the owner (§6) |
| Latency per repository  | < 1 ms       | p50 102 ms    |                                                                                                                                                                                                                                          |
| Cost (20 repositories)  | 0            | $0.006 [est.] |                                                                                                                                                                                                                                          |

¹ The code's database and auth misses are all consequences of the wrong app in those three monorepos.

### 4 · Acceptance criterion → test: precision first

A criterion is "met" only when the test's title or its key steps and assertions exercise the criterion's subject,
action and expected outcome, including the actor or role and any negation; when unsure it is "open".

- `proofVerdict` (`packages/shared/src/criterion-proof.ts`, code): refusal check ("cannot", "denies"… need a test that
  checks a refusal), actor check (every role the criterion names must be the test's actor) and coverage (every salient
  word of the criterion, after stemming and synonyms, must appear in the test).
- Generated CRUD tests (`entityCoverage`) prove a criterion only through `proofVerdict`, with the test's steps and
  assertions read from the generated spec. Hand-written `acceptance.yaml` rules keep their reviewed regular expressions.
- The report's mapping: the deterministic pass must also satisfy `proofVerdict`; the decider is then asked only over
  tests that pass the refusal and actor checks, each described by its key assertions, and its match is accepted only
  at confidence ≥ 0.8 (`CRITERION_MATCH_CONFIDENCE`; a probability of at least 0.9 on a two-option question).
- Regression: the false matches of build `f195341c` (viewer cannot edit, invite a teammate, audit log, search, tag
  filter, plus sign-up role and filtered export) all come out "open" (`acceptance-proof.test.ts`, `criteria.test.ts`).

Measured on 38 labelled criterion → test pairs (19 true proofs):

| Matcher                               | Precision | Recall |
| ------------------------------------- | --------- | ------ |
| Deterministic `proofVerdict` alone    | 1.00      | 0.74   |
| Deterministic, then decider at ≥ 0.8  | 1.00      | 0.95   |
| Deterministic, then decider at ≥ 0.9  | 1.00      | 0.74   |
| (previous threshold) decider at ≥ 0.5 | 1.00      | 0.95   |

The bar was precision ≥ 0.98. The decider was asked 15 times, p50 113 ms.

### 5 · Already on the decider, unchanged

Compiler recipe, capabilities and Abuse Guard; component selection; business rules (T3); remediation triage and the
improvement estimate; the orchestrator's route, safety and tool decision in `orchestrate()`. No type (c) decision was
found being made by a model.

## Measurements

All numbers from `bench/agent-decisions/` (runs in `bench/agent-decisions/runs/`). Real models: `gemma-4-26b-a4b-it`
on every route, decider `jev-1.13.0`, both through the TurbineH AI gateway on staging. Prices [est.]: open model
0.27 / 0.54 $/MTok in/out, decider 0.42 $/MTok (same constants as `bench/frontiers/brain.ts`). Latency excludes
gateway rate-limit waits.

**runAgent tool decisions — 20 labelled first actions** (`--set actions`):

| Version                                | Correct | Latency p50 / p95 / mean | Model input tokens | Cost / 1000 turns |
| -------------------------------------- | ------- | ------------------------ | ------------------ | ----------------- |
| `main`, gateway as deployed (no tools) | 6/20    | 1761 / 4553 / 2136 ms    | 8,998              | $0.605            |
| `main`, gateway fixed                  | 20/20   | 1571 / 2582 / 1546 ms    | 19,558             | $0.700            |
| This ADR                               | 20/20   | 1397 / 2041 / 1463 ms    | 11,178             | $0.583            |

**runAgent end to end — 20 multi-turn clinic conversations, two runs each** (`--set conversations`; the clinic,
conversations and deterministic success checks of the brain bench; a pending action at the end of the script is
confirmed once, the same for both versions):

| Version                     | Success | Latency p50 / mean (run 1, run 2) | Model in / out tokens | Decider calls | Cost / 1000 conversations |
| --------------------------- | ------- | --------------------------------- | --------------------- | ------------- | ------------------------- |
| `main`, gateway fixed       | 40/40   | 2330 / 2351, 1975 / 2249 ms       | 161,882 / 18,295      | 85            | $2.141                    |
| This ADR (decider per turn) | 40/40   | 1955 / 2393, 2004 / 2253 ms       | 140,899 / 21,459      | 89            | $2.116                    |
| Rejected: decider per step  | 20/20   | 2220 / 2972 ms                    | 55,863 / 12,384       | 79 (one run)  | $2.610                    |

On the scripted mock (component `tests/mock-llm`, plumbing only: its clinic script has no booking rules) both versions
make the same calls and pass the same cases (19/20 actions, 11/54 conversations).

Reading: equal accuracy; −13 % model input tokens and −1.2 % cost end to end, −17 % cost and −5 % mean latency on
single-action turns; the per-turn mean latency is within noise (+1 %). The change is kept on cost.

## Consequences

- runAgent's tool choice is a calibrated decision logged with its probabilities in the audit (`next`), and the model
  prompt carries one tool schema (or none) on the first step of a turn.
- Generated apps' tool calling works through the TurbineH gateway at all (it did not before).
- Fewer "met" criteria: those a test does not visibly exercise are now "open", with where to implement them.

## 6 · For the owner

- **Monorepo app choice** (§3): the decider is more accurate (20/20 vs 17/20) at ~0.1 s and ~$0.0003 per integration.
  Two options: keep code (rule applied here) and improve the heuristic (prefer the app that already has the database
  and sign-in the capability reuses), or accept the decider for this one decision when the repository has several apps.
- PR #84 (not-verified packages): once a package can ship with a failing gate, a criterion's proving test must also
  have passed in that build.
- The gateway has no open-decider fallback for generated apps (JEV only); runAgent falls back to the model choosing.

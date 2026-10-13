# ADR-0046 · Agent brain speed: templated confirmation reply, per-attempt timeouts, gateway hedging (off)

- Status: accepted
- Date: 2026-10-13
- Numbering: 0043–0045 are taken (#96, #97 and `feat/domain-components-2`); this may need renumbering at merge.
- Context: the agent-brain bench (`bench/agent-brain/RESULTS.md`, PR #95) left the tail (p95/max per turn) as the
  remaining risk of runAgent on serverless, and named three candidates: gateway hedging above the gemma p90, a
  templated reply after a confirmed irreversible action, and shorter per-attempt timeouts with one retry. The owner
  stays on serverless (no dedicated inference). Rule: keep only what improves p95/max without hurting success or
  raising cost by more than ~10 %.

## Decision

### 1 · Templated reply after a confirmed action (kept)

- `runAgent` (component `ai.orchestrator.turbineh`): when the person answers a pending action with an explicit yes or
  no (`readConfirmation` or the button), the turn is settled by code: the decider is not asked (audit decider
  `skipped`). If the confirmed tool succeeds, the reply is `confirmedReply(summary, result)`: the tool's own
  person-facing `message` when it returns one (the bookings domain component does), otherwise
  `Done: <confirmed summary>. Reference: <id>.`. No model call; the flag `templated-reply` is recorded.
- A failed action (`{ error }`: ToolError, timeout, failed step) goes to the model as before, which explains it and
  offers an alternative; the decision for the route and safety is taken then.
- Type (c) of ADR-0039: a confirmation is deterministic, so no model is needed to act on it. Safety is unchanged: the
  input guard and limits still run first, and no model runs on such a turn.

### 2 · Per-attempt timeouts (kept)

- runAgent model calls (`chatWithTools`): each attempt is bounded by `AI_ATTEMPT_TIMEOUT_MS` (default 15 s) within the
  run budget; a stuck attempt is retried once (a second stuck attempt ends the call); transient failures (network,
  429, 5xx) keep the two retries they had. Plain chat and embeddings (possibly long outputs) keep the whole budget per
  attempt.
- Decisions: `AI_DECIDER_ATTEMPT_TIMEOUT_MS` (default 5 s; decider max observed 2.9 s) with one retry on timeouts,
  network errors, 429 and 5xx (before: a single 15 s attempt); then runAgent falls back as before.

### 3 · Gateway hedging (implemented, off by default)

- `handleGateway` for chat completions: when `AI_GATEWAY_HEDGE_AFTER_MS` > 0 (per-model overrides in
  `AI_GATEWAY_HEDGE_AFTER_MS_BY_MODEL`) and no answer arrived by then — or the first request failed fast with a
  network or server error — one duplicate goes to the same model (or the next allowed one with
  `AI_GATEWAY_HEDGE_TARGET=next`). The first valid answer wins; the other request is aborted. One deadline for both
  (`AI_GATEWAY_TIMEOUT_MS`): both slow is a 504.
- Bounds: at most one hedge per request, and a per-app daily budget taken atomically in the database
  (`reserveAiHedge`: max(`AI_GATEWAY_HEDGE_BUDGET_MIN`=20, `AI_GATEWAY_HEDGE_BUDGET_RATIO`=0.1 × the app's chat calls
  of the day) per model). Hedges never count against the app's rate limit and never bypass validation: both requests
  carry the same validated body (tools, output cap).
- Usage: the app is billed only for the answer it receives, on the model that wrote it. Migration `0010` adds
  `hedges` and `hedge_wins` to `ai_gateway_usage`; the ops page shows them. Cost stays internal. Responses carry
  `X-TurbineH-Hedge` (`none|budget|primary-won|hedge-won`) and `Server-Timing: upstream;dur=…` (no prices).
- **Off by default** (`AI_GATEWAY_HEDGE_AFTER_MS=0`): measured at 3.8 s on staging it fired on 2–6 of 137–178 chat
  calls per run and never answered first, with no p95/max gain. The slow serverless calls are slow for both copies.

## Measurements

`bench/agent-brain` (54 conversations, 3 in parallel, real models: gemma-4-26b-a4b-it and deepseek-v4-flash-0731 via
the decider's routes, decider jev-1.13.0). Same-day controls because the provider was faster than in the baseline.
Prices [est.] as in `bench/agent-brain/prices.ts`.

| Run (2026-10-13)                                    | Success | Turn p50 / p90 / p95 / max s          | Chat calls            | Decider calls | USD / 1,000 conv |
| --------------------------------------------------- | ------- | ------------------------------------- | --------------------- | ------------- | ---------------- |
| Baseline r1 / r2 (PR #95, production gateway)       | 54/54   | 3.30–3.51 / 7.0 / 7.7–7.9 / 13.9–32.0 | 181–184               | 115–120       | 2.07–2.11        |
| `main`, production gateway (same day)               | 54/54   | 2.37 / 4.85 / 6.72 / 11.96            | 181                   | 121           | 2.08             |
| `main`, staging gateway with hedging at 3.8 s       | 54/54   | 2.43 / 5.57 / 8.56 / 13.27            | 178 (6 hedged, 0 won) | 116           | 2.03 (2.10 ¹)    |
| This ADR's runtime, production gateway (no hedging) | 54/54   | 2.34 / 4.20 / 4.66 / 9.37             | 139                   | 78            | 1.40             |
| This ADR, staging, r1                               | 54/54   | 2.39 / 4.46 / 4.88 / 9.01             | 137 (2 hedged, 0 won) | 76            | 1.36 (1.38 ¹)    |
| This ADR, staging, r2                               | 54/54   | 2.33 / 4.50 / 4.83 / 10.91            | 141 (2 hedged, 0 won) | 80            | 1.44 (1.46 ¹)    |

¹ Cancelled hedges counted at the answer's tokens, an upper bound [est.].

- The template answered all 43 confirmation turns per run: −42 chat calls (−23 %) and −43 decider calls (−35 %) per
  54 conversations; confirmation turns from p50 1.26 s to tool time.
- Same day, production gateway: p95 6.72 → 4.66 s, max 11.96 → 9.37 s, cost −33 %, success unchanged by kind.
- Claude direct (baseline, not re-run): p95 8.12–9.62 s, max 19.9–70.4 s, 11.61–19.40 USD per 1,000 conversations.

## Consequences

- Domain components should return a person-facing `message` (in the app's language) from irreversible tools: it is
  the reply after confirmation. The generic fallback is English.
- Staging app tokens have a 200,000-token daily quota, less than one bench run: `run.ts --on-quota` rotates the
  staging app's token and continues.
- Hedging can be enabled per deployment with `AI_GATEWAY_HEDGE_AFTER_MS` (e.g. 3800) if a provider shows independent
  slow requests; re-measure before enabling it in production.

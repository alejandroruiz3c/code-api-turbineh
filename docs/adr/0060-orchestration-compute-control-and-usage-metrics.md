# ADR-0060 · Orchestration: reasoning control, no empty answers and measurable usage

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: the first staging trials of Intelligence Orchestration (ADR-0059) returned an **empty** `content` for
  "Say hi in 5 words" (1,657 completion tokens), took 3–9 s for greetings and one-word facts, and flagged
  `plan-fallback` on simple classifications. Measured on the provider: the open models behind the gateway reason by
  default and the reasoning counts against `max_tokens`; the engine's planning call (400 tokens) was spent entirely on
  reasoning on every request. `reasoning_effort: "none"` turns reasoning off on all three models (0 reasoning tokens,
  0.4–0.7 s). Separately, the owner wants anyone trying the product by API or MCP to measure its benefit clearly:
  per-call cost and latency, and a comparison with a frontier model.

## Decision

1. **Reasoning control through the gateway.** The chat body accepts the OpenAI-compatible `reasoning_effort`
   (`none | minimal | low | medium | high`) and forwards it only when given (also for direct `/v1/chat/completions`
   calls). The engine's I/O reports the upstream `finish_reason` to the engine as `finishReason`. Both are an
   additive extension of the v1 engine interface (`packages/orchestration/src/types.ts` unchanged): the private engine
   ≥ 1.1.0 sets/reads them through local types, older engines ignore them. Formalising them in `types.ts` is a
   follow-up interface change (public first, then the engine).
2. **Compute policy lives in the private engine** (its ADR-0004): planning without reasoning; no reasoning on the fast
   route and bounded reasoning on larger routes only when the plan calls for it; an empty answer is retried without
   reasoning, then on another route, then reported. The gateway maps that report (engine message `NO_ANSWER`) to
   **502 `no_answer`** "The AI models returned no answer. Please retry." An orchestrated answer is never empty.
3. **JSON mode is structured output**: `response_format: {type: "json_object"}` on the orchestrated chat becomes
   `schema: {type: "object"}` for the engine, which validates and returns the JSON value only (no code fences).
   `choices[0].finish_reason` is `"length"` when the engine flags a truncated answer; `turbineh.flags` lists the
   engine's flags.
4. **Per-request measurement** (`apps/web/src/server/ai-metrics.ts`). Every billed call made while a request runs is
   observed on that request (wrapping the gateway's `record` + `addSpend`), so the numbers are exactly what was
   charged. Each orchestrated chat, `/v1/orchestrate`, `/v1/agent` and direct chat answer carries
   `turbineh.metrics` (OpenAI shape otherwise unchanged); MCP `orchestrate`/`chat` results carry
   `structuredContent.metrics`:
   `latency_ms`, `model_calls`, `input_tokens`, `output_tokens`, `cost_usd` (internal cost as charged to the trial),
   `frontier_reference_cost_usd` (the same tokens at a frontier model's list price, USD 4 / 20 per million input /
   output — the reference of the agent benchmarks), `frontier_reference` ("frontier model reference (list price)"),
   `savings_usd`, `savings_pct`. Headers on the same answers (and on failed requests that already incurred cost):
   `X-TurbineH-Latency-Ms`, `X-TurbineH-Cost-USD`, `X-TurbineH-Frontier-Reference-Cost-USD`,
   `X-TurbineH-Savings-Pct`, plus `X-TurbineH-Trial-Remaining-USD`. Latency is wall time inside the gateway from the
   request's arrival to its answer. No vendor names on product surfaces.
5. **Cumulative report per account.** Requests with at least one model call are stored in `ai_request_metrics`
   (numbers only: surface, ok, latency, calls, tokens, cost, reference cost; migration 0015). `GET /v1/ai/v1/usage`
   and the MCP tool `usage_report` return, for all AI apps of the token's account: `requests`, `failed_requests`,
   `model_calls`, `input_tokens`, `output_tokens`, `latency_ms.p50/p95` (successful requests), `cost_usd`,
   `frontier_reference_cost_usd`, `savings_usd`, `savings_pct`, `since`/`until`, `by_surface` (same fields per
   `chat`, `chat-direct`, `orchestrate`, `agent`, `mcp:orchestrate`, `mcp:chat`) and `trial`
   (`cap_usd`, `spent_usd`, `remaining_usd`, `reached`). Free (no model call).

## Consequences

- Simple requests answer in about a second on the fast route at a fraction of the tokens; empty answers become a
  retry or an explicit, retryable error.
- The frontier reference is an estimate on the same token counts (a different model would use a different number of
  tokens); it is labelled as a list-price reference everywhere it appears.
- `trial.spent_usd` counts every billed call of the account (including calls before measurements existed); the report's
  `cost_usd` counts measured requests only.
- One extra insert per measured request; failures to store never fail the request.

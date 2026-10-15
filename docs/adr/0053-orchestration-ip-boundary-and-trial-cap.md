# ADR-0053 · Orchestration IP boundary (thin client + private engine) and a $2 trial cap per account

- Status: accepted (number may need renumbering at merge); the private engine's location and delivery are superseded by
  ADR-0057 (own repository, pinned release at `private/agent-orchestrator`)
- Date: 2026-10-15
- Context: two owner requests.
  1. **Trial cap.** "For every user of our inference orchestration component, cap spend at $2; when the limit is
     reached, tell them they reached the trial limit and to contact alex.ruiz@turbineh.com." The gateway had per-app
     tokens with a daily token quota, but no spend tracking per TurbineH account.
  2. **IP boundary.** The repository is public, and the library is open — except TurbineH's orchestration (its AI
     structure on top of the decider), which is the paid offer. Until now the whole orchestration ran inside every
     generated app: `src/lib/ai/{agent,decider,orchestrator,models,plan}.ts` of component #001 shipped the decision
     questions, route descriptions, thresholds, decider-first action, templated confirmation replies, retry policy and
     system prompts to every customer, and to anyone reading the repository. It must be protected without changing
     behaviour.

## Decision

### 1 · Trial cap per TurbineH account (gateway)

- Every gateway call (chat, embeddings, decisions, and every call inside the new orchestration endpoints) adds its
  internal cost in USD to `ai_owner_spend` (migration `0012_ai_trial_spend.sql`), keyed by the account that owns the
  app token — so all apps of an account share one balance. One atomic upsert per call (`addAiOwnerSpend`).
- Cost (`apps/web/src/server/ai-cost.ts`): open models at the provider's EUR list price × 1.08 [est.] (same table as
  the worker's build cost; unknown models priced like the most expensive), decisions at the upper bound of the
  documented range [est.], embeddings at a rounded-up estimate. Internal only; never shown as a price list.
- Pre-check before any upstream call: when spend ≥ cap, HTTP **402** `application/problem+json` with
  `code: "trial_limit_reached"` and the message _"You've reached the trial limit of the TurbineH orchestration ($2).
  Contact alex.ruiz@turbineh.com to continue."_ (title and detail). The call that crosses the cap is answered;
  the next one is refused. Concurrent calls at the edge can overshoot by at most the calls in flight (accepted).
- `AI_TRIAL_CAP_USD` (default 2; 0 = no cap). Internal owners (`AI_TRIAL_EXEMPT_OWNERS` plus `OPS_OWNER_IDS`: smoke and
  benchmark keys) are not capped; their spend is still recorded.
- Generated apps show the message: the client raises `AiTrialLimitError` (a `UserFacingError`) on 402, `/api/assistant`
  answers 402 `{ error, code }`, and the assistant widget shows it as an alert and disables sending.
- The build page (`AiAccess`, `GET /v1/builds/{id}/ai-token`) shows the remaining trial balance of the account, or the
  limit message with the contact when it is reached.

### 2 · Thin client in generated apps, orchestration behind the gateway

Component `ai.orchestrator.turbineh` 0.4.0 ships only the client:

- `runAgent` keeps what must run in the app: tool definitions, argument validation, `prepare`/`execute`, the
  deterministic confirmation gate for irreversible tools (`readConfirmation`, buttons, 30-min expiry), timeouts, the
  step limit, state trimming, safety guards, usage and audit. Each step is one request to
  `POST {TURBINEH_AI_URL}/v1/agent` with the conversation, the tools (JSON Schema, irreversible flag) and what happened
  since the last step (`phase: start | continue | confirmed`); TurbineH answers with a reply or tool calls.
- `orchestrate()` sends one request to `POST {TURBINEH_AI_URL}/v1/orchestrate` (JSON Schema for structured output) and
  validates the answer with the app's Zod schema; `embed()` is unchanged (gateway embeddings).
- Removed from apps: `decider.ts`, planner and executor prompts, route descriptions, thresholds, the decision
  questions, the decider-first logic, templated confirmation replies, the model retry policy.
- Local mode: with `AI_BASE_URL` and **no** `TURBINEH_AI_TOKEN`, a plain open tool loop against any OpenAI-compatible
  endpoint (no TurbineH orchestration). With a token, the gateway is always used (in E2E, Playwright sets both, so
  the real protocol is exercised against the mock).
- Behaviour and latency: the same model and decision calls happen in the same order; they are now made by the
  gateway (one request per step instead of one per model call + one per decision, so the app→gateway round trips do
  not increase). A confirmed action still costs no model or decision call (the gateway writes the reply from the
  tool's result).
- `security.ai-safety.turbineh`: the client keeps only generic deterministic guards (injection patterns, sizes, PII,
  secrets, limits, audit); the safety policy that refuses requests (`unsafe`) runs at TurbineH and comes back as 422
  `unsafe_request` → `AiRefusedError` ("This request can't be processed. Please rephrase it.").
- Mocks: `tests/mock-llm` (E2E) and `services/ai-mock` (verification) speak the new protocol (scripted, no decisions).

### 3 · Private engine, public interface and open fallback

- `packages/orchestration` (`@turbineh/orchestration`, public): the protocol and engine interface
  (`OrchestrationEngine`, `EngineIO`) and an **open minimal fallback** (one route, no decisions, generic prompt, every
  tool offered, one attempt). The public repository builds, tests and runs with it.
- `private/orchestration` (proprietary, its own git repository, git-ignored here): the real engine. Dependency-free
  TypeScript importing only types from the public interface. `apps/web/orchestration.config.mjs` aliases
  `@turbineh/orchestration/engine` to it (Turbopack `resolveAlias`, Vitest alias) when present.
- The gateway (`apps/web/src/server/ai-orchestration.ts`, routes `/v1/ai/v1/agent` and `/v1/ai/v1/orchestrate`) owns
  authentication, trial cap, rate limit/quota, request validation, the model allow-list (the engine cannot call a
  model the gateway does not allow), hedging, billing and error mapping; the engine only decides.
- Production fails loudly without it: `next.config.ts` throws when `VERCEL_ENV=production` or
  `TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1` and the package is missing (`TURBINEH_ALLOW_OPEN_ORCHESTRATION=1` is the
  deliberate escape hatch); `infra/staging/deploy.sh` refuses a web deploy without it or with uncommitted changes in it
  and prints its revision; `.vercelignore` re-includes it (without `.git`, `node_modules`, `bench`). Workers do not
  use it (they assemble apps from the public catalogue).
- The agent-runtime benchmark harnesses (`bench/agent-brain/{run,split}.ts`, `bench/agent-decisions/{run,runtime,
clinic}.ts`) moved to the private package; results and reports stay public as evidence for earlier ADRs.

### 4 · Fewer internal details in delivered apps

Delivered files no longer carry trigger ids or model names: the Backup Coder header is `// turbineh:generated-backup`
only; COMPONENTS.md drops the decider probability columns (best/covers/risk) and trigger ids, and "Written by the Backup
Coder" becomes "Written by TurbineH"; the report's build metrics drop `trigger`/`model`/`by`/`slot` fields and its
footer no longer names the writer model; capability package docs drop decision confidences; handover gaps drop
trigger ids; a recipe template and a component guide drop internal references.

## Consequences

- Same features and tests; the in-app runtime tests became protocol tests (client) and engine tests (private).
- Generated apps from before 0.4.0 keep working: the gateway still serves `/v1/chat/completions`, `/v1/embeddings`
  and `/v1/systemone` (also capped by the trial).
- History: the public git history still contains the earlier in-app orchestration sources. Purging it needs a history
  rewrite, which is the owner's decision (paths listed in the delivery report).
- Open questions for the owner: whether `packages/decider` (typed adapter over the public decider SDK and the open
  alternative), the selector/compiler decision questions and `services/open-decider` should also become private; they
  are part of the open library's selection pipeline, so they stay public here.

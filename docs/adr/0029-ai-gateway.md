# ADR-0029 · TurbineH AI gateway: AI apps use TurbineH's model and decider access

- Status: accepted (owner decision, 2026-10-12)
- Date: 2026-10-12
- Amends: ADR-0028 (the orchestrator no longer needs the client's TypeSafe/JEV or model-provider keys).

## Context

AI apps (recipe `ai-agents`, component #001 `ai.orchestrator.turbineh`) asked the client for a TypeSafe/JEV key and
a model-provider key. The owner decided that, for now, they use TurbineH's own access; TurbineH charges more for AI
apps later. TurbineH's keys must never leave TurbineH's infrastructure.

## Decision

- **Gateway** in the web app (`software.turbineh.com`, staging `staging.software.turbineh.com`), root
  `/v1/ai`, same layout as the sandbox simulator (`services/ai-mock`):
  `POST /v1/ai/v1/chat/completions`, `POST /v1/ai/v1/embeddings` (OpenAI-compatible subset) and
  `POST /v1/ai/v1/systemone` (the path the official `@typesafe-ai/sdk` calls when its base URL is the gateway).
- **Per-app token** (`tbh_ai_…`, shown once, stored as SHA-256) from `POST /v1/builds/{id}/ai-token` (create/rotate;
  `GET` usage; `DELETE` revoke) or created automatically by **Deploy for me**. Only builds that include the
  orchestrator get one.
- **Forwarding** server-side with TurbineH keys (`AI_GATEWAY_UPSTREAM_KEY` for the open-model provider,
  `AI_GATEWAY_TYPESAFE_KEY` for JEV). Unknown request fields are dropped.
- **Limits:** allow-list of documented open models (chat, embeddings, decider), body size, output tokens cap,
  `stream` refused, per-app requests per minute and daily token quota (database counters: serverless instances share
  no memory), upstream timeout. Missing TurbineH keys → 503 (never open).
- **Privacy and safety:** prompts, outputs and keys are never logged; provider error bodies are never echoed. The AI
  Safety Pack still runs inside the app before anything reaches the gateway; only the orchestrator files may call it
  (Semgrep `turbineh.ai-direct-model-call`).
- **Usage** per app, day, endpoint and model (calls, tokens in/out) in `ai_gateway_usage` for billing; clients see
  calls and tokens; estimated cost is internal (`/ops`).

## Consequences

- AI apps need network access to TurbineH; if a token is revoked or the quota is reached, the app's AI answers with a
  safe error (the rest of the app keeps working).
- Pricing of AI usage for clients is a later decision; the data to bill it is recorded from day one.

## Amendment (2026-10-12, owner decision): reroute direct model calls instead of blocking

A direct call to a model or model SDK no longer blocks delivery. The rules `turbineh.ai-direct-model-call` and
`turbineh.ai-sdk-dependency` are warnings; security remediation always attempts the first one (never routed to a
person) with exact instructions: rewrite it to `orchestrate()`/`embed()` from the app's orchestrator (so the AI Safety
Pack, the gateway, quotas, usage and audit apply), or — if the app has no orchestrator — disable the call with a clear
error instead of shipping it unrouted. Rerouted calls are listed in SECURITY.md. Verified on a generated ai-agents app
with an injected direct OpenAI call: green before (warning), rewritten to `orchestrate()`, green after with no AI
findings. The same transformation is meant for systems clients bring in F2.

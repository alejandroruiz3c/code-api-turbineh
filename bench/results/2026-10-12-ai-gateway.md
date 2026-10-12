# AI gateway re-certification · 2026-10-12 (ADR-0029)

Component `ai.orchestrator.turbineh` switched from client keys (`AI_BASE_URL`/`AI_API_KEY`, `TYPESAFE_*`) to the
TurbineH AI gateway (`TURBINEH_AI_URL` + `TURBINEH_AI_TOKEN`). Verification points `TURBINEH_AI_URL` at the
deterministic simulator (`services/ai-mock`), which has the same layout as the gateway.

| Build | Recipe | Checks | Criteria verified | Corrections | Notes |
|---|---|---|---|---|---|
| ai-01 (support assistant with knowledge base, local pipeline) | ai-agents | 11/11 | 4/5 | 0 | `.env.example` has only `TURBINEH_AI_URL` / `TURBINEH_AI_TOKEN` for AI |

Gateway unit tests (`apps/web/src/server/ai-gateway.test.ts`, mocked upstreams): auth, model allow-list, `stream`
refused, body and output-token limits, rate limit and daily quota, TurbineH key used upstream, usage recorded,
provider errors and keys never echoed, 503 when TurbineH keys are missing.

# ADR-0059 · Intelligence Orchestration as a product: trial signups, developer API and remote MCP

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: owner decision: TurbineH's inference orchestrator becomes a standalone product, "Intelligence
  Orchestration", that developers connect by API or MCP, with the existing $2 trial cap per account (ADR-0053). A
  landing page has a "try it free" form; its server must be able to provision a trial and email the connection data.
  Until now the only way to get an orchestration token was a finished AI build (`POST /v1/builds/{id}/ai-token`, or
  the deploy job). The orchestration engine stays private (ADR-0053, ADR-0057): the public repository only wires
  endpoints to the existing engine interface.

## Decision

### 1 · Trial provisioning: `POST /v1/ai/trial-signups` (server-to-server)

- Auth: `Authorization: Bearer <ORCHESTRATION_SIGNUP_SECRET>` (env, optional; compared in constant time over SHA-256
  digests). Unset → **404** (the endpoint does not exist); missing or wrong → **401**.
- Body (zod): `email` (≤ 254, trimmed, lowercased), `name` (1–120), optional `company` (≤ 160), `useCase` (≤ 2000)
  and `clientIp` (the person's IP as seen by the landing server; used only for the per-IP limit, stored as an HMAC).
  Invalid → 400 `invalid_request` with the offending `fields`.
- Account: `trial:<first 24 hex of sha256(email)>`, a TurbineH owner id that is not tied to any build (no auth user
  row: the gateway only needs an owner id). Profile in `orchestration_trials` (migration
  `0014_orchestration_trials.sql`: email, name, company, use case, signups, dates); every signup in
  `orchestration_trial_signups` (owner, IP hash, time).
- Token: an `ai_apps` row with `build_id NULL` and the usual defaults (`AI_GATEWAY_DAILY_TOKENS`, `AI_GATEWAY_RPM`).
  A repeat signup reuses the account (same spend, same cap) and rotates the token: the account's build-less tokens are
  revoked and a new one is issued, in one transaction. Build tokens are unaffected.
- Rate limits (last 24 h): 3 per email (`ORCHESTRATION_SIGNUPS_PER_EMAIL`), 10 per client IP when `clientIp` is sent
  (`ORCHESTRATION_SIGNUPS_PER_IP`), 200 in total (`ORCHESTRATION_SIGNUPS_PER_DAY`, bounds the exposure to 200 × $2 a
  day) → 429 `rate_limited`. Without `clientIp` there is no per-IP limit (the caller is the landing server).
- Response **201**: `{ token, prefix, apiBase, mcpUrl, trialUsd, remainingUsd, existing, contact }` with
  `apiBase = ${BETTER_AUTH_URL}/v1/ai/v1` and `mcpUrl = ${BETTER_AUTH_URL}/v1/ai/mcp`. The token is shown once; the
  landing emails it. `Cache-Control: no-store`.
- Ops: `pnpm --filter @turbineh/db trials [limit] [--json]` and `GET /v1/ops/trials` (staff only) list trial
  accounts with their spend and active token prefix.

### 2 · Developer API on the existing gateway

- `POST /v1/ai/v1/chat/completions` gains **orchestrated routing**: `model: "turbineh-orchestration"` (or `"auto"`, or
  no model) maps the conversation to one orchestrated request (system/developer messages → instructions, last user
  message → input, earlier turns → history) and answers in the OpenAI `chat.completion` shape. An allowed model id is
  forwarded to that model exactly as before (generated apps are unaffected). `tools` and `stream` are refused on the
  orchestrated model (use `/agent`).
- `POST /v1/ai/v1/orchestrate` and `/agent`: `timeoutMs` becomes optional (default 60 s, capped by the gateway).
- Every gateway and orchestration response of a capped account carries `X-TurbineH-Trial-Remaining-USD` (after the
  call's cost is added); the 402 carries `0`. Nothing in the gateway depended on a build: trial tokens work on chat,
  orchestrate, agent and embeddings.

### 3 · Remote MCP server at `/v1/ai/mcp`

- Streamable HTTP transport in its stateless form: each POST is one JSON-RPC message answered with JSON (no session,
  no SSE); notifications → 202; GET/DELETE → 405. Protocol revisions 2025-11-25, 2025-06-18, 2025-03-26. Written in a
  few lines like the CLI's stdio server (ADR-0036), without the SDK dependency in the web app; verified with the
  official SDK client and `claude mcp list`.
- Same `tbh_ai_` Bearer token (401 with `WWW-Authenticate` otherwise), same trial cap, rate limit and quota (the tools
  call the same `orchestrateFor` as the HTTP endpoints).
- Tools: `orchestrate` (task, input, optional schema and instructions), `chat` (messages), `trial_status` (spent, cap,
  remaining, reached, contact). Refusals (402, 429, 422, 5xx) come back as tool error results with the problem's
  message, so the agent shows the trial-limit message and the contact.
- `/v1/ai/*` is already outside the access-token gate (`proxy.ts` matcher excludes `v1/`); a test pins it.

## Consequences

- Anyone with the signup secret can create capped trial accounts; the per-day total bounds the cost. The secret lives
  only in Vercel env and `.env.local` (`infra/staging/web.ts` sets it when present, `STG_` override for staging).
- `/orchestrate` keeps returning the fields generated apps use (including the route's model); the chat completion and
  MCP results do not name models.
- Trial accounts have no sign-in: the token is the credential. Linking a trial to a TurbineH sign-in, paid plans and
  per-account dashboards are follow-ups.

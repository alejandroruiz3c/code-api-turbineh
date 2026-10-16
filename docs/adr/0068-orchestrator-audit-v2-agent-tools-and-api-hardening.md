# ADR-0068 · Orchestrator audit v2: agent lookup tools, honest escalation, API/CLI/MCP hardening

- Status: accepted
- Date: 2026-10-17
- Context: external test report "Informe de pruebas v2: orquestador de TurbineH para agentes" (16-10-2026), incidences
  I-1…I-20. Landed in #131 (from #128, #129, #130, #132).

## Decision

- **Generated agents do what was asked (I-1, I-2).** When a criterion says the agent looks up an entity by an
  identifier ("order status by order number"), the assembler generates a read-only, tenant-scoped tool
  `lookup_<entity>` (`src/server/agent-tools.ts`, zod params, explicit "not found") registered with the agent, plus a
  unit test. FAQ-like entities map to the recipe's knowledge base instead of a parallel CRUD table.
  `escalate_to_human` emails the team (ADMIN_EMAILS); if email is not configured or fails, the escalation is still
  stored and the user is told honestly that the team follows up in the app.
- **API, CLI and MCP (I-6, I-7, I-12, I-14…I-17, I-19, I-20).** `x-turbineh-workspace` is validated (400
  `invalid_workspace`); with a web session the cookie's workspace applies (documented). Cookie-authenticated writes
  require `Content-Type: application/json` (415). One problem format (`code`, `message`, `action`) everywhere; clear 400
  for malformed JSON. The AI token is available by API (`/v1/builds/{id}/ai-token`), CLI (`turbineh ai-token`) and MCP
  (`ai_token`). CLI: `unauthorized` instead of `network` without a token, exit 2 for usage errors. MCP `build` requires
  `spec`/`specFile`. No unmeasured durations in agent instructions. Public `/health` returns only ok/service/worker.
- **Component E2E made deterministic:** auth rate limit configurable in tests (`AUTH_RATE_LIMIT_MAX`), public-pages
  filter located by id, scheduled-jobs idempotency independent of the cron period.
- **Components-only offers are wording-independent:** a candidate matched by a component's canonical criterion and its
  tested hint is kept even if the decision engine returns no confirmation (only for non-blocked requirements); the
  scheduler hint only applies when scheduling is the requirement's action.

## Open

I-3 (unplanned flows in KPIs), I-18 (SARIF rule list), I-8/I-9 (package docs from met criteria only), canonical
criterion + E2E for lookup tools, and tool arguments returned by the decision engine instead of extracted by regex.

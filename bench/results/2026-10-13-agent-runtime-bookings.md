# 2026-10-13 · Agent runtime + booking domain (ADR-0033) · Frontiers Capability B on staging

Prompt: the exact Capability B text of `bench/frontiers/spec.md` (Flex Physio booking assistant), submitted to
staging (`POST /v1/builds`, worker deployed from branch `feat/agent-runtime-bookings`).

## Build `7e267117-12de-43df-9973-7bffb0ffb5a6`

| Item | Result |
| --- | --- |
| Recipe | `ai-agents` (requested and built) |
| Domain detected by code | `bookings` → `domain.bookings.turbineh`; parameters: Flex Physio, Europe/Madrid, 3 physiotherapists, Mon–Fri 09:00–19:00, 45-min slots, First visit 60 €, Follow-up 50 €, 24 h notice, questions: prices / address / what to bring (no defaults needed) |
| Components (native) | `ai.orchestrator.turbineh` (runAgent), `security.ai-safety.turbineh`, `domain.bookings.turbineh` + recipe set |
| Generic CRUD generated | none (bookings, physiotherapists and patients are implemented by the domain component) |
| Gate | 11/11 checks green: install, migrations, lint, typecheck, unit, build, e2e, secrets, static, dependencies, licences |
| E2E | includes `tests/e2e/booking-assistant.spec.ts` against `tests/mock-llm` (no internet) |
| Acceptance criteria (model-written, 8) | 8 met, 0 open (`ACCEPTANCE.md`) |
| Static findings | none (`turbineh.ai-direct-model-call` not raised: every model call goes through the orchestrator) |
| Corrections | 1 (unrelated Backup Coder unit test `tests/unit/backup/ops-idempotency.test.ts`) |
| Timings | total 218 s; compile 2.8 s; integrate 13.9 s; verify 200.5 s |

## Local sandbox runs (same `verify()`)

The Capability B app assembled locally with the same components passed 11/11 checks after two fixes found by the
E2E suite (`scrollIntoView` returning a Promise became an effect cleanup in Chromium; unicode confirmation words).

## Rule check

`packages/verifier/src/ai-rule.test.ts` (Semgrep 1.178.0): the hand-written client of the Capability B "+TurbineH" run
(`fetch(\`${cfg.LLM_BASE_URL…}/chat/completions\`)`) is flagged; `src/lib/ai/{models,decider,agent}.ts` and
`tests/mock-llm` are not.

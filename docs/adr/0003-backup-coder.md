# ADR-0003 · Backup Coder: primary and secondary models

- Status: proposed — provider proposed (Scaleway); **API key pending (Gate G0)**
- Date: 2026-10-10
- Context: PLAN §2.4; model policy in ADR-0001 (open-weights only, except JEV)

## Decision

| Slot      | Model                   | Licence | Released   | Why                                                                                                                                    |
| --------- | ----------------------- | ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Primary   | **DeepSeek-V4.1-Flash** | MIT     | 2026-09-10 | Best documented open model on long agentic coding (DeepSWE, Terminal-Bench 2.1) with the lowest documented price among top open coders |
| Secondary | **GLM-5.2**             | MIT     | 2026-06-16 | Only open model in the top 5 of the independent SWE-rebench; different lab → real redundancy                                           |

Source: TurbineH model knowledge base, `02-multimodal-y-especializados/codigo-y-agentes.md`.

Rejected: closed models (policy); Kimi K3, Qwen3.8-Flash-Next, MiniMax M3 (licences restrict code-assistant or
MaaS businesses); MiMo-V2.6-Pro (released < 14 days ago at decision time — revisit after 2026-10-11/12).

## Serving

- Both models are too large to self-host for the beta; they are consumed through an OpenAI-compatible endpoint of
  an inference provider with EU data processing — never through the labs' official APIs (data processed in China;
  Z.ai is on the US Entity List).
- **Proposed provider: Scaleway Generative APIs (Paris, EU-sovereign).** Verified on 2026-10-10 in its supported
  models page: `glm-5.2` (MIT) and `deepseek-v4-flash-0731` (MIT), both serverless, with structured outputs and
  `reasoning_effort: none`. One account also serves the production compiler candidate `gemma-4-26b-a4b-it`
  (Apache-2.0).
- Scaleway serves DeepSeek **V4-Flash-0731**, not V4.1-Flash. Primary on Scaleway is therefore
  `deepseek-v4-flash-0731`; V4.1-Flash (e.g. via Nebius, NL) is the upgrade path once the benchmark (D1) shows the
  difference matters.
- Configuration: `BACKUP_CODER_{PRIMARY,SECONDARY}` (`<provider>:<model>`), `_BASE_URL`, `_API_KEY`.
- Reasoning must be disabled (`reasoning_effort: none`) for gap filling: a thinking model can spend the whole output
  budget before emitting code (observed with the local stand-in in D0).

## Usage rules (enforced in `packages/backup-coder`)

1. Triggers T1–T6 only; policy lives in the calling module.
2. Minimal context (neighbour contracts, BuildSpec slice, error). Never rewrites the app.
3. Output carries `// turbineh:generated-backup` and goes through the same verification and Security Pack.
4. Automatic failover primary → secondary; every activation is traced (trigger, model, tokens, result).
5. Every covered gap is written to `catalog/gaps/` (catalog flywheel).

## Validation

Final choice is validated by the benchmark in D1 (most green builds per cost wins).

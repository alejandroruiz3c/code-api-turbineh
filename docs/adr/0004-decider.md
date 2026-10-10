# ADR-0004 · Decider: JEV (primary) and Quyet (open alternative) behind one interface

- Status: accepted (design); JEV access pending (Gate G0)
- Date: 2026-10-10

## Decision

- `Decider` interface (`packages/decider`) with two backends built on the **official TypeSafe SDK**
  (`@typesafe-ai/sdk`), because Quyet implements the same `/v1/systemone` request/response shape:
  - `JevDecider`: `https://api.typesafe.ai`, model pinned to **`jev-1.13.0`** (never `jev-latest`, thresholds are
    calibrated per version).
  - `OpenDecider`: Quyet 1.0 served by `services/open-decider` (stdlib HTTP server around `quyet`), same SDK with
    another `baseURL`. Medium (4B) for local dev; Large (31B, one 80 GB GPU) for production.
- `FallbackDecider` routes primary → fallback on any error and records `fallbackFrom`. Routing is configuration,
  never prompt-driven.
- Choice with more options than the backend allows (Quyet: 10) is split automatically into a two-level beam:
  stage 1 batches every group (plus all other questions) in one request; stage 2 picks among the finalists.
- Choice confidence is recomputed with the documented TypeSafe formula on every backend, so thresholds are portable.

## Best practices enforced in code

See `docs/DECIDER_BEST_PRACTICES.md`. Highlights: all questions for a state in **one** request; many atomic
questions instead of one complex one; `none_of_the_above` by default; state budget checked before sending
(fail instead of silent truncation); per-action act/review/escalate bands.

## Open points (Gate G0)

- No TypeSafe API key in the project key files → JEV smoke test not run.
- `quyet` 1.0.2 is younger than 14 days (ADR-0002 exception).
- Quyet is English-first; production prompts to the decider are written in English.

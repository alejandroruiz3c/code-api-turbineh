# ADR-0008 · Budget D1–D3 and cost circuit breaker

- Status: accepted by the owner (2026-10-10) — figures are **estimates**, not measurements; confirm prices in each console
- Date: 2026-10-10
- Inputs: owner's cost estimation workbook (per-app cost assumptions), provider pricing in the model knowledge base

| Item                 | What it covers                                                                          | Estimate (EUR)               |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| Inference · Scaleway | Compiler, glue and Backup Coder for ~300 dev + bench builds                             | 150                          |
| Benchmark baseline   | Conventional full-generation agent on 20–40 prompts (largest token consumer)            | 300                          |
| JEV · TypeSafe       | Every decision of every build (input-only pricing)                                      | 20                           |
| GPU · open decider   | Quyet-Large comparison day (80 GB) + small GPU for the Quyet fallback during the launch | 150                          |
| Compute              | API, workers, warm sandbox pool (microVM hosts) in one EU region                        | 150                          |
| Database             | Postgres + pgvector (managed)                                                           | 30                           |
| Launch buffer        | Viral beta traffic on D3, protected by the daily cap                                    | 300                          |
| **Total ceiling**    |                                                                                         | **≈ 1,100 → hard cap 1,500** |

## Controls (enforced in code from D2)

- Global daily cost circuit breaker (default 100 EUR/day during the launch); per-build token, time and cost caps.
- Alerts at 50 % and 80 % of the D1–D3 cap; the build queue switches to waitlist mode when the cap is reached.
- Budget alerts also configured in each provider console.

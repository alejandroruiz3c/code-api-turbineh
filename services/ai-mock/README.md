# ai-mock

Deterministic AI simulator used **only inside the isolated verification network** of apps that use the TurbineH
orchestrator (component `ai.orchestrator.turbineh`, ADR-0028). No model, no network, no secrets: the sandbox has no
internet, and AI apps still need their full E2E run.

| Endpoint                        | Behaviour                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/chat/completions`     | If the system message ends with `JSON_SCHEMA: {…}` (how the orchestrator asks for structured output), returns the minimal valid instance of that schema (first enum value, one array item). Otherwise `Mock answer: <start of the last user message>`. |
| `POST /v1/embeddings`           | Hash-seeded unit vectors of the requested `dimensions` (default 1024): same text → same vector.                                                                                                                                                        |
| `POST /v1/systemone`            | TypeSafe SDK response shape: `noul` → 0.05, `choice` → first label (0.9), `score` → 0.                                                                                                                                                                 |
| `GET /v1/models`, `GET /health` | Liveness.                                                                                                                                                                                                                                              |

The verifier starts it with the sandbox image (`node /mock/server.mjs`, read-only mount), so no extra image has to be
built or pulled on worker hosts.

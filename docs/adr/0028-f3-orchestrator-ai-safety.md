# ADR-0028 · F3: AI in client apps through the orchestrator #001 and the AI Safety Pack

- Status: accepted (owner decision, 2026-10-12)
- Date: 2026-10-12
- Implements PRODUCT_DESCRIPTION.md (component #001, "AI safety siempre") and PLAN §2.3 / roadmap F3.

## Order (explicit owner decision)

The product description sets the order "connect existing software (F2) before allowing AI systems (F3)". On
2026-10-12 the owner decided to do **F3 now, before F2**, as one more covered use case ("AI agents and inference
processes"), the last one for now. F2 (connecting existing repositories, preceded by the in-depth input security
audit design) stays next in the roadmap. Until then the beta rule "no AI in client builds" is replaced by: **AI only
through the orchestrator, always with the AI Safety Pack**.

## Decision

- **Component #001 `ai.orchestrator.turbineh`** (native, Apache-2.0): `orchestrate()` = AI Safety Pack checks →
  a small open model writes a plan (intent, subtasks, output type) → JEV by TypeSafe (official SDK
  `@typesafe-ai/sdk@0.6.0`, MIT; `TYPESAFE_BASE_URL` for an open SystemOne-compatible decider) answers one batch of
  questions: route (which open model), unsafe (threshold 0.5) and tool (threshold 0.5) → the chosen open model
  answers (structured output validated with zod, one repair attempt) → output scan → `ai_usage` and `ai_audit` rows.
  `embed()` for knowledge bases (1024 dimensions, Matryoshka truncation). Any OpenAI-compatible provider; defaults are
  documented open models served in the EU (Scaleway: gemma-4-26b-a4b-it planner, routes fast/balanced/frontier,
  qwen3-embedding-8b). Without a decider key the default route is used and the audit says `decider-unavailable`.
- **`security.ai-safety.turbineh`** (native, always with #001, no switch): prompt-injection refusal for requests,
  documents treated as data (control tokens removed, delimited), size limits, optional PII redaction, secret scan of
  every answer, per-user rate limit and daily token allowances per user and workspace, tool allow-list from the app's
  registry with human confirmation for irreversible tools, audit with SHA-256 of the input (no content).
- **Enforcement:** TurbineH Semgrep rules `turbineh.ai-direct-model-call` (model SDK imports or model endpoints
  outside `src/lib/ai/models.ts` and `src/lib/ai/decider.ts`) and `turbineh.ai-sdk-dependency` (model SDKs in
  `package.json`); both ERROR, so any build — including Backup Coder and glue output — that bypasses the orchestrator
  fails verification.
- **Recipe `ai-agents`** (extends saas-crud): assistants with instructions and enabled tools, chat with knowledge-base
  answers that cite their sources (pgvector, cosine, HNSW), pending confirmations for irreversible tools, batch
  processes (classify / extract / summarise) with their own runner (`/api/jobs/run`, Vercel Cron), CSV import/export,
  usage page per workspace (requests and tokens, no prices) and AI audit for admins. `requiredComponents` makes code —
  not the decider — select #001 and the Safety Pack in every build. The recipe ships its own `package.json` + lockfile
  (base dependencies + the decider SDK); a test keeps it aligned with saas-crud.
- **Verification without internet:** `services/ai-mock` (deterministic OpenAI-compatible chat/embeddings subset and
  the SystemOne response shape) runs on the build's isolated network from the sandbox image (read-only mount, nothing
  to pull or build on worker hosts). E2E of AI apps exercises the real orchestrator code path against it.

## Consequences

- Clients need their own TypeSafe key and model-provider key; usage is per workspace and queryable (the owner will add
  a client-facing usage metric later). Prices stay internal.
- Heuristic injection patterns can miss new phrasings; the decider's `unsafe` question is the second check.
- `jobs.queue` handlers cannot yet be registered from a recipe, so ai-agents runs batches with its own runner.

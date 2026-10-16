# ADR-0066 · Compiled snippets, Discover relevance, real durations and calibrated estimates, honest product copy

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-16
- Context: external audit v2 (16/10/2026) — F-04 (snippets of "verified" components with wrong imports: exceljs,
  gray-matter, better-auth, MCP SDK, i18next, dinero.js, react-colorful…), §5.3 (Discover precision ~0.2 for "support
  agent"; 0.69 precision@5 on the 20 reference queries of the validation benchmark), N-03 ("Finished in" kept counting;
  "Generating · 0 s" on finished flows; home "5 min average" from a different formula), F-06 (identical "~162 s /
  10,039 tokens" on every plan; real errors of 22–38 % in lines and 11–42 % in time), F-09 (TurbineH AI gateway as the
  only first-class option; no SLA/DPA; no behaviour when it is down) and L-01…L-06 (product-site copy). Owner
  principle: every piece of information shown must be real; nothing claimed for its own sake.

## Decision

### 1. Public usage snippets are generated and compiled (F-04)

- **Source.** A component's public example (Discover, `/v1/capabilities`, `/catalog/index.json`, `llms.txt`, and the
  `docs/components/*.md` shipped into apps) is never written by hand or by a model. It is, in order:
  `snippet.ts` in the component directory (a usage file owned by the component), else the component's own
  `contract.test.ts` turned into a snippet (`packages/catalog/src/snippets.ts`, TypeScript AST): real imports with
  `vitest` removed and unused names pruned, file- and `describe`-level declarations, then the body of the first test
  with each assertion turned into `console.log(value); // → expected` (`toThrow` → `try/catch`, `rejects` → `.catch`).
  Parameter examples (JSON) and CLI/HTTP examples keep their text and are checked differently.
- **Kinds and checks** (`example_check` in guide.yaml, also exposed as `exampleCheck` in the API and index):
  - `typescript` (137 components): one file per snippet, `tsc --noEmit` with the contract harness settings (strict,
    `noUncheckedIndexedAccess`) against the pinned versions — the catalogue purls, declared `@types`, the harness pins
    and, for the rest of the stack (pg…), the saas-crud template pins. `compiled: { against, typescript, on }` records
    what and when; the date is kept while snippet, packages and TypeScript are unchanged.
  - `app` (19 TurbineH modules): `snippet.ts` importing the component's own files through `@/…`; compiled inside the
    assembled apps that contain it (`verify:recipe --all --domains --quick --snippets`; a component no combination
    assembles gets one extra target; a snippet compiled nowhere fails the run).
  - `json` (5): validated against the component's `params.schema.json`.
  - `shell` (2): every `turbineh <command>` must be a CLI command and every `/v1/…` path an API route.
- **Interface signatures** written as `import …` (247) are taken from the imports the component's own usage really
  makes (default vs named export, subpath) and compiled with the snippets; one that cannot be confirmed is removed.
- **Commands.** `pnpm catalog:snippets [ids]` derives, compiles (sandbox container; on a CI runner with
  `--ignore-scripts`, type-check only) and writes `example`, `example_check` and repaired interfaces as text edits
  (hand-written guides keep their formatting). `--check` writes nothing and fails on any compile error or drift.
- **Enforcement.** CI job "Snippets compile · pinned versions" (`pnpm catalog:snippets --check`, every PR) and the
  "Assembled combinations" job with `--snippets`; `catalog:validate` and a unit test fail when a guide's example is
  not exactly the derived snippet or lacks its compile record. The intake documentation step (`catalog:document`)
  uses the component's own usage instead of the model's example.
- Found on the way: `files.upload.busboy` declared no types (a generated app importing it fails strict type-check);
  `integration.types: "@types/busboy@1.5.4"` (1.5.5 is newer than 14 days).
- Result: **163/163** components with a verified example; 137/137 TypeScript snippets and every import signature
  compile against the pinned versions (2026-10-16), 19/19 app snippets compile in the assembled apps (12/12
  combinations pass), 5 JSON and 2 CLI/API examples check.

### 2. Discover relevance (§5.3)

- One ranking for `/v1/capabilities`, the Discover fallback (`/api/discover`, previously an `ILIKE` query) and the
  CLI/MCP search (`searchCapabilities`, deterministic, no model): use cases and components ranked together; each word
  of the need weighs by its rarity in the catalogue (idf) times the strongest field that names it (name/capability 3,
  keywords 2, description 1.5, use cases 1; a small intent-synonym table at half weight); similarity in [0, 1].
- **Minimum similarity 0.25** and a **cut at 0.3 × the best result**; **rerank by the capability description** (share
  of the need the description names, weight 0.8). Text in parentheses of a description is an example, not what the
  capability does ("YAML (agent and prompt configuration)" no longer answers "support agent").
- **CI** (`packages/engine/src/discover-precision.test.ts`): precision@5 ≥ 0.8 on the 20 reference queries of the
  validation benchmark (`bench/validation/discover-queries.json`, same metric definition) and on 12 held-out queries
  (`fixtures/discover-holdout.json`) written before they were measured and never used for tuning; "support agent"
  must return the AI agents use case first and never colour pickers, YAML or i18n; an unrelated need returns nothing.
- Measured (catalogue in git, 2026-10-16): reference set **0.69 → 0.89** (0.91 before the three social components
  of ADR-0067 joined the catalogue); held-out **0.81** at first measurement, **0.90** after adding search stop words
  ("into", "from"…), the only change made after seeing it. Mean recall@5 on
  the reference set 0.63 → 0.54 and 10.7 → 3.6 results per query: fewer, more precise results. The weights were
  chosen on the reference set; the held-out number is the honest one.
- Components on Discover show their example as code with "Snippet compiled against <pkg>@<v> (TypeScript x) on
  <date> · from <source>".

### 3. Real durations (N-03)

- Duration = `finished_at − started_at`, where `started_at` is the latest `queued` event of the row (else
  `created_at`) — the same definition as the owner report (`RUN_STARTED_AT_SQL` in `packages/db/src/builds.ts`). No
  migration: both are persisted. `GET /v1/builds/{id}` returns `started_at`, `duration_ms` (finished only) and
  `estimate_vs_actual`. "Finished in" uses `duration_ms` only, never now − start.
- The flow page renders the persisted state on the server and hands it to the client (`initial`): a finished flow is
  final from the first paint, no "Generating · 0 s".
- The home KPI and `/v1/activity` average use the same formula over finished flows; no data → "—".

### 4. Calibrated estimates (F-06)

- With ≥ 5 finished runs of the recipe, plan estimates are medians with a **p50–p90 interval** (time over the last
  10 runs, tokens and lines over the last 3) and say so; with fewer, the benchmark averages stay, labelled
  "Benchmark average: fewer than 5 finished runs…". The result shows **estimated vs real** with the deviation.
- Backtest on staging history (90 finished runs, 11 recipes, 2026-10-12…15; each run predicted only from earlier
  runs of its recipe; 44 runs had ≥ 5 earlier): median error **time 16.4 %** (fixed estimate 24.1 %), **lines 21.7 %**
  (fixed 1,238 %), **tokens 36.9 %** (fixed 40.7 %). Time and lines meet < 25 %; tokens do not (bimodal: the glue
  cache makes them 0). The windows were chosen on the same runs, so these are optimistic.

### 5. AI: gateway or your own provider (F-09)

- Generated DEPLOY.md presents "Option 1 · TurbineH gateway" and "Option 2 · your own OpenAI-compatible provider
  (AI_BASE_URL, AI_API_KEY, AI_MODEL)" side by side; neither is an override and `TURBINEH_AI_TOKEN` is no longer
  "required". Behaviour when the endpoint is unavailable is what the shipped code does: one retry within
  `AI_TIMEOUT_MS`, then "The assistant is not available right now", recorded in usage and audit; no automatic switch.
- "Data processing (DPA) and service levels (SLA)": not published; contact before sending personal data. **Owner
  decision** (terms, contact address).

### 6. Product-site copy (L-01…L-06)

- "In seconds" removed everywhere (and the unmeasured "about 30 / 15 / 5 minutes" of the handover and Deploy for me);
  "Free and open" explained (Apache-2.0 library vs invitation beta of the hosted service vs AI gateway or own
  provider; orchestration, infrastructure and inference beyond the trial on quote); supported stack declared on the
  home page and in the stack selector (TypeScript + Next.js + PostgreSQL + Drizzle; other stacks marked as not
  supported for new apps); "STEP 02 · THE MOAT" removed; the product described in the hero; "Leave" → "Sign out";
  verified pull request into an existing repository (never merged, one commit to revert) on the home page.

## Consequences

- A snippet can no longer drift from the package: changing a contract test, a pinned version or TypeScript changes
  the snippet or its compile record, and CI fails until `pnpm catalog:snippets` is run and the result compiles.
- Discover returns fewer results; queries the catalogue does not cover return nothing instead of noise.
- Token estimates remain outside the 25 % target and are shown as intervals with their basis.
- Owner decisions: DPA/SLA content and contact; meaning of "YES IF"; public wording of the beta and "on quote".

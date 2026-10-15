# ADR-0052 · Scope gate: only covered use cases are operated

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Supersedes: ADR-0050 §4 ("Free-form needs always lead to a buildable plan")
- Context: owner rule, verbatim: "sólo debes permitir operar peticiones de casos de uso o que involucren componentes
  que cubrimos sea porque se entienden así o porque piden la opción específica. Esta regla es crítica para asegurar que
  todo hace lo que debe tal y como se verificó en cada componente en su momento. Peticiones que muestren casos de uso o
  cosas que no cubrimos directamente se le dice que por ahora la librería no cubre esos casos de uso y que le
  notificaremos con prioridad cuando esté."

  An external audit made the cost of ADR-0050 §4 concrete: the request "autonomous social media publisher" was
  compiled as `out_of_scope`, then silently built on `saas-crud` (`closest_recipe ?? "saas-crud"` in
  `apps/worker/src/pipeline.ts`) as "AutoPublish Social", and shown as "Package verified 11/11" with 0 of 15 functional
  criteria met. The checks were real, but they verified a CRUD app nobody asked for; the request's actual use case
  (publishing to social networks, AI drafts) was listed as "what is left" or as "Needs your configuration".

## Decision

### 1 · The gate

Right after the request is compiled and before any selection or generation, the worker runs the scope gate
(`packages/engine/src/scope-gate.ts`, wired in `apps/worker/src/scope.ts`). It is evaluated on the request's atomic
requirements — the compiled acceptance criteria — and on the request's own words, not only on the headline:

1. **Code (deterministic, ADR-0039 §1(c))** marks a requirement _not covered_ when it needs an integration with an
   external platform no approved component connects to (social networks, messaging, CRMs, accounting, Google
   Calendar sync…, only when the text acts on the platform — a "handle" field or a footer link is plain content), an
   autonomous action without a person's confirmation, a native mobile app, hardware or a video game, or AI generation
   in a use case without AI (no `ai-agents` recipe, no TurbineH orchestrator).
2. **Code** marks a requirement _covered_ when a test shipped with the recipe proves it (acceptance.yaml rules).
3. **The decider** (ADR-0039 §1(a); JEV primary, open decider fallback — never a closed vendor model) judges the rest:
   one atomic Noul per requirement ("does it need a capability that neither the use case nor the components
   provide?"), all in **one batched request**. Not covered at p ≥ `OUTSIDE_SCOPE_THRESHOLD` = 0.6 (code; to calibrate
   with `bench/`). If the decider is unreachable: covered when the use case is a covered recipe, not covered otherwise.
4. **The headline** (the request's first part, which names the product) is checked by code too. If it is outside what
   the library covers, the use case itself is not covered, whatever the compiled criteria say.

A request is **operable** only when its use case maps to a covered recipe and every requirement is covered, or every
requirement maps to catalogue components (a request no family matched may then be built on the closest template —
recorded, no longer a silent fallback), or the person chose verified components explicitly (`components`).

### 2 · Uncovered → nothing is generated

The flow ends `failed` with `ProductError` `use_case_not_covered` (the revived `ERRORS.outOfScope`):

- message: "The library doesn't cover this use case yet. We'll notify you with priority as soon as it does."
- `notCovered`: the requirements not covered (also in `metrics.scopeGate` with the reason for each).
- The raw reason stored on the row is `Use case not covered by the library: a | b`; `explainFailure` maps it (and the
  legacy "out of scope" reasons) to the same problem on the web, the API (`problem`, `errors[]`, 422 on
  `POST /v1/plans`) and the CLI (exit 5, the list printed under the message). The UI is English-only (no i18n layer), so
  the strings are English.

### 3 · Partial coverage → explicit choice, before generating

A covered recipe with at least half of its requirements covered (`PARTIAL_MIN_SHARE`) and an uncovered headline-free
remainder is **partial**. Nothing is dropped silently:

- Plans: the spec keeps only the covered requirements and an explicit name ("<App> (covered part only)"); the plan
  carries `scope` (`status: "partial"`, `name`, `removed[]` with why, `message`) and, first in `needsApproval`,
  `Build only the covered part, "<name>": … removed from scope — …`. It is not a gap notice, so `generate: true`,
  `turbineh build` and the MCP `build` tool stop at exit 3 until the person approves (`{"approve": true}`,
  `--approve`, the checkbox and "Build only the covered part" on the web).
- Direct builds (`POST /v1/builds`): refused like an uncovered request unless `covered_only: true` is sent.
- Removed requirements never appear as "what is left", as plan `missing`, or as "Needs your configuration".

### 4 · Demand and priority notification

Every uncovered or partial request is recorded by the worker (`packages/db/migrations/0011_use_case_demand.sql`):
`use_case_demand` (build, owner, email when the caller is a signed-in account, request, status, use case, missing
requirements with why, timestamp; one row per flow) and `priority_notifications` (one row per owner, subscribed until
`notified_at` is set). The owner reads it at `GET /v1/ops/demand` (staff only, 404 otherwise) or with
`pnpm --filter @turbineh/db demand [limit] [--json]`. No confirmation email is sent: the platform has no outbound email
infrastructure today and this ADR adds no vendor.

### 5 · Explicit components

`POST /v1/plans` accepts `components: [ids]` (validated against the approved catalogue, 422 `unknown_component`);
the CLI `--components id1,id2` (`plan`, `build`) and the MCP `components` argument map to it. Exactly those
components (plus what they declare in `relations.requires`) are planned, nothing inferred.

### 6 · Same area, from the audit

- **F18 — one state model for checks and requirements.** `flowOutcome` adds `checks`, `requirements` and `badge`
  ("Checks 11/11 · Requirements 6/8 met") from `metrics.handover`/`verify` and `metrics.acceptance`. The web badge, the
  CLI `status` and the API show that line; the `verified` state is labelled "Checks passed", and an app whose checks
  pass with open requirements is titled "Build checks passed in the TurbineH sandbox · N requirement(s) not met yet".
  The result screen separates "Settings" from "Requirements not met yet".
- **F20 — quickstart from the real package.** The worker stores the app's `package.json` scripts with the artefact;
  `appQuickstart` builds the commands from them and the real file list (`.env.example` at the root, no `db:seed` when
  the template has none, `pnpm dev` migrates a local PostgreSQL by itself). The generated AGENTS.md no longer points
  open criteria to a non-existent `tests/e2e/app.spec.ts`: with no matching spec it names a new one,
  `tests/e2e/requirements.spec.ts (new file)`.

### 7 · Agents

The agent block written by `turbineh init` (AGENTS.md / CLAUDE.md), the Claude Code skill, the MCP server
instructions and `/use` state the rule: uncovered requests are refused with `use_case_not_covered` + `notCovered`;
tell the user it is not covered yet (priority notice when it is), never rephrase the spec to get around it; partial
specs need the user's approval for the covered part; explicit components via `turbineh search` + `--components`.

## Consequences

- The decider gets one more batched request per new request (only for requirements code cannot place). Generation from
  an approved plan is not gated again.
- Requests that ADR-0050 built "on the closest template" with a long "what is left" are now refused or reduced with
  consent. Expect more `use_case_not_covered` outcomes; `use_case_demand` is the input for what the library covers next.
- Open: the code lists (platforms, autonomy, AI words) and the decider threshold need calibration on a labelled set in
  `bench/`; confirmation emails wait for an approved email channel.
- Tests: `packages/engine/src/scope-gate.test.ts` (covered recipe, explicit components, the audit's uncovered request,
  partial, decider fallback, false-positive guards, message mapping, F18 badge, F20 quickstart),
  `apps/worker/src/scope.test.ts` (against the real catalogue), `apps/web/src/components/scope-gate.test.tsx`.

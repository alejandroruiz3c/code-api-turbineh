# ADR-0037 · Robust builds: deliver not-verified packages, attribute failures, NFRs are not entities, check combinations

- Status: accepted (2026-10-13)
- Context: Frontiers rerun of Capability B (`bench/frontiers/spec.md` on `wip/frontiers-bench`). Two staging builds
  (7362be2a…, 66af3182-b4e3-4b9f-abb7-f94a54ae47a8) failed with 10/11 checks. One E2E test of
  `domain.bookings.turbineh` still assumed the default E2E owner was not staff, but since #77 that owner is verified
  staff (fixed in #81). The consequences, not the bug, are what this ADR addresses:
  1. the build delivered **nothing** (artifact null), so Claude Code waited, retried and wrote the whole app itself
     (1,089 s, $1.68, gate failed);
  2. the correction loop removed 12 unrelated integrated components ("removed after failed corrections (T4)");
  3. the compiler turned "rate limits" into a `RateLimitTracker` entity with CRUD pages and E2E;
  4. nothing in CI or `verify:recipe` assembled the bookings domain with `ai-agents`, so the cross-PR regression reached
     main.

  Owner priority: TurbineH plugs into a coding agent's flow with zero extra work, and every fix is generic.

## Decision

### D1 · Never deliver nothing; never present it as verified

- `deliveryKind(verifyResult)` (verifier, code only) decides what a finished build delivers:
  - `verified`: every check passed;
  - `unverified`: only quality checks failed (install, migrations, lint, typecheck, unit, build, E2E);
  - `report_only`: a security or policy check blocks — `secrets`, `static`, `dependencies` or `licenses` failed, a
    blocking security/policy finding exists, or a scan did not report (fail closed). No runnable code leaves the
    sandbox; only TURBINEH_REPORT.md and SECURITY.md are stored.
- `unverified` packages are stored like verified ones (ZIP, git bundle, docs, capability package with state
  `generated`). They carry the exact failures, read deterministically from the gate output (`gateFailures`:
  Playwright and Vitest headers, tsc/eslint locations). Each failure has its step, test title, file:line, owner (D2),
  first error line, the cheapest command that reproduces it (`rerunCommand`) and a suggested fix. The suggested fix
  is a deterministic text: reproduce, where, who owns it, what to change, re-run.
- The same facts appear everywhere, with the same words: "Delivered, not verified: N/M checks passed".
  - `turbineh.json`: `verified: false`, `checks`, `failures[]`, failures first in `left`.
  - AGENTS.md: status line and "What is left".
  - TURBINEH_REPORT.md: a section at the top.
  - API `GET /v1/builds/{id}`: `verified`, `delivery`, and `error` = label + first failure + fix.
  - Engine `FlowResult`: error `verification_failed`.
  - The UI: badge, panel with each failure and fix, no repository-integration button.
  - CLI: state label, and `turbineh left`.
- **Product contract kept.** The build status stays `failed` and the FlowState of a delivered, not verified package is
  `generated` ("package produced, not verified"). It is never `verified`. Everything that needs a passed gate keeps
  requiring `status = done`: deploy, "improve and redeliver", GitHub pull requests and AI tokens. Old clients that
  poll for `done`/`failed` still stop, and now find the artifact.
- Test-only proof: a worker started with `TURBINEH_TEST_FLAGS=1` honours the prompt marker
  `[turbineh-test:force-e2e-failure]`, which adds one E2E test that always fails. The marker is removed before any
  model sees the prompt. `infra/staging/deploy.sh production` refuses a worker whose environment file sets the flag.
- The gate output keeps each failing step's key lines (`FAILED_LINE`) at the top of its detail. Licence results are
  printed last, so a long failure log can no longer push them out of the bounded tail and turn a quality failure into a
  false licence block.

### D2 · Corrections never remove unrelated components

- The assembler records who owns each file in `.turbineh/owners.json` (`turbineh.owners/v1`). Owners are
  `recipe:<id>`, `component:<id>`, `entity:<Name>` or `generated`. After finalisation the remaining post-assembly parts
  are added as `integration:`, `glue:`, `backup:` and `rules:` owners. The file ships with the package, so agents can
  ask "who owns this file?".
- `attributeFailures` (integrator) maps each failure to the owner of the failing file and of the local files it
  imports, plus the npm packages they import. A post-assembly part is implicated only when:
  - one of its files is the failing file or one of its imports; or
  - it is an integrated library that the failing file or its imports import; or
  - it is T3 business rules of the entity that owns the failing test.
    An install failure implicates the libraries named in the log, otherwise every integrated library, because they are
    the only post-assembly dependency changes. A failure without any file implicates nothing.
- `culpritsOf` removes exactly the implicated parts. An integrated library leaves with its glue; a glue helper can leave
  alone. The old fallback, a full reset to the assembled commit that dropped every integration, is gone. A failure in a
  recipe or catalog component (66af3182) removes nothing, and the package is delivered as D1 describes.
- Each round is recorded in `metrics.attribution` (failure, owner, imports, implicated, removed) and in the
  `correcting/attribution` event. Regression test: `apps/worker/src/attribution.test.ts` assembles ai-agents +
  domain.bookings with the 12 libraries of 66af3182.

### D3 · Non-functional requirements are capabilities, never entities

- Two mechanisms, applied in `compileIntent` and again in the pipeline for stored specs (idempotent):
  - the compiler's entities prompt says so;
  - `separateNonFunctional` removes what slips through, by word patterns on the entity name, precise enough to keep
    `StageLimit`, `Log`, `Session` or `Metric`. It also removes their pages and reference fields, and adds the
    capabilities that implement them.
- The mapping from requirement to capabilities:
  - rate limits → `ops.rate-limit`, plus `security.ai-safety` in AI apps;
  - input limits, prompt injection, abuse, spam → `security.ai-safety`, `ops.rate-limit`, `data.validation`;
  - timeouts and retries → `ops.retry`;
  - logging, audit and monitoring → `observability.logging`;
  - idempotency → `ops.idempotency`.
- The requirement itself stays an acceptance criterion.
- The result is recorded in `metrics.nonFunctional` and in the `compiling/non-functional` event.
- Tests (`packages/compiler/src/non-functional.test.ts`) use the Capability B prompt and the entities of every spec in
  `bench/frontiers/learning.md`.

### D4 · Cross-component regressions are caught before main

- `apps/worker/src/combinations.ts` assembles a recipe the way the pipeline does: the recipe's required components,
  the domain components its request selects (`detectDomains`), native components for its default and always-on
  capabilities, and their `requires`. `DOMAIN_PROBES` holds one representative request per domain component, and a test
  fails when a domain component has none.
- `verify:recipe` options:
  - `<recipe>|<recipe+component>` checks one combination;
  - `--list` prints the combinations;
  - `--all` runs the full gate on every combination;
  - `--domains` keeps only recipe + domain combinations;
  - `--quick` runs lint, typecheck and unit (sandbox `quickCheck`). On CI it runs typecheck and unit directly, because
    the runner is ephemeral and holds no secrets.
- CI job `assembled`: on every PR that touches `catalog/`, the assembler, `domains.ts` or the combination code (and on
  main), it runs `verify:recipe --all --domains --quick`. The full E2E gate stays local (`verify:recipe --all`,
  CONTRIBUTING.md).

## Consequences

- A failing gate now costs the coding agent one targeted fix instead of the whole app. Security blocks still never
  deliver runnable code.
- Integrations are kept unless the evidence names them, so a package can carry an integrated library whose glue was
  removed. That library stays pinned and unused, and it is reported.
- Specs that list a real domain concept whose name matches an NFR pattern (for example a "SpamReport" entity) lose it.
  The patterns are deliberately narrow and covered by tests. Widen them only with a test.
- CI grows by one job, which runs only when the catalogue or the assembler change.

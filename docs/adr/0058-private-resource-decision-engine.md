# ADR-0058 · Resource decisions behind a private engine (interface + open fallback here)

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: owner decision (2026-10-15): TurbineH's orchestration becomes two private products — the agent inference
  orchestrator (ADR-0053, ADR-0057) and the **resource decision** orchestrator — and everything that still decided
  resources in this public repository moves to private ("asegurando que los sistemas siguen siendo 100 % operativos"):
  the decider adapters (`packages/decider`), the decision questions, prompts and thresholds of selection, compilation,
  scope gate, entity kinds, monorepo app choice, remediation, criterion evidence and T3 business rules, the open
  decider service (`services/open-decider`), the planning decider (`apps/web/src/server/plan-decider.ts`) and the AI
  gateway's hedging policy. ADR-0053 left these public as an open question; this ADR closes it.

## Decision

### 1 · Public interface and open fallback (`@turbineh/decider`)

- `packages/decider/src/contract.ts`: the interface. `DecisionEngine` (`edition`, `version`, `fromEnv` for the worker,
  `forPlanning` for the web, `hedging`) and `Decider`, one method per decision point: `selectComponents`,
  `classifyIntent`, `entityKinds`, `scopeOutside`, `chooseApp`, `triageFindings`, `fixableFindings`, `matchCriteria`,
  `businessRules`, plus `selectionVersion` (part of the selection cache key). Methods that may have no answer return
  `null`; callers keep their deterministic code for that case and for errors, exactly as before.
- `transport.ts`: the public decision API client (official SDK) handed to the engine as `DecisionIO`; keys stay in the
  server environment.
- `open.ts`: the open minimal fallback — deterministic heuristics, no model calls, no keys: approved components that
  declare the capability (catalogue order); the product family sharing most words with the public recipe descriptions;
  no optional capability inferred; a short refusal list for obvious abuse; no answer for every other decision; the
  gateway never hedges. The open library builds, tests and runs with it (public CI).
- Every public call site keeps its signature and deterministic code (scope gate rules, entity rules, lexical evidence,
  `pickAppPath`, report assembly…) and asks the engine only for the decision itself.

### 2 · Private engine (`alejandroruiz3c/turbineh-resource-decider`)

- Standalone private repository, semver releases, zero runtime dependencies, vendored copy of `contract.ts`
  (byte-compared on every deploy), its own CI (gitleaks, format, lint, strict typecheck, unit tests with coverage
  gates, contract drift) and an integration suite that runs this repository's former decision tests — unchanged in
  their expectations — through the public sources with the private engine.
- Pinned in `infra/private/versions.json` as `resource-decider` (`requiredBy: web, worker`, ADR-0057) and checked out at
  `private/resource-decider` by `infra/private/sync.sh`.

### 3 · Loading, and failing loudly in production

- **Web**: `apps/web/resource-decider.config.mjs` aliases `@turbineh/decider/engine` (Turbopack and Vitest) to
  `private/resource-decider/src/index.ts` when present, else to the open fallback; `next.config.ts` refuses a build
  with `VERCEL_ENV=production` or `TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1` without it.
- **Worker** (Node, tsx): `@turbineh/decider/engine` resolves the engine once at startup — the private entry by path
  when present, else the open fallback. The systemd units set `TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1`, so a
  production or staging worker without it exits at startup (systemd shows the error) instead of deciding with the
  fallback, and logs `decision engine {edition, version}`. `TURBINEH_ALLOW_OPEN_ORCHESTRATION=1` is the deliberate
  escape hatch, as for the web.
- **Deploys**: `infra/staging/deploy.sh` syncs and verifies the pinned release for `web` and `worker` before deploying
  (ADR-0057); the worker rsync ships `private/resource-decider` (without `.git` and `node_modules`); `.vercelignore`
  uploads it without benchmarks, services, integration tests or coverage.

### 4 · Behaviour unchanged

Same questions, option keys, state, thresholds, pinned models (`jev-1.13.0` primary, open decider fallback), the same
number of decision requests, and the same selection cache keys in production (policy version 2; the open fallback uses
another version, so it never reuses production selections). Verified by the integration suite and by the public suites
run with the private engine installed (worker, engine, selector, compiler, remediation, reporter, web gateway).

## Consequences

- Public tests now cover the plumbing and the open fallback; the decision tests (questions and thresholds) run in the
  private repository.
- Without the private engine, public builds decide with heuristics: fewer optional capabilities and selections ranked
  by catalogue order (documented as the open edition).
- History: the public git history still contains the moved sources; purging it is the owner's decision (paths listed
  in the delivery report).

# ADR-0015 · WP10: component integration, Backup Coder gap filling and corrector

- Status: accepted
- Date: 2026-10-11
- Related: PLAN §2.4 (T1–T6), §4 (build lifecycle), ADR-0003 (Backup Coder), ADR-0010 (decomposition), ADR-0014

## Decision

### Integration of approved external components (`@turbineh/integrator`)

Components the recipe does not already contain are integrated after assembly:

1. **Install (deterministic):** the exact version from the approved manifest goes into `package.json`; the lockfile
   is refreshed inside the sandbox (registry only, no secrets). Versions never come from a model.
2. **Contract test in the app:** the component's `contract.test.ts` (it passed certification) is copied to
   `tests/unit/components/<id>.test.ts`, so the app's own verification proves the library works here.
3. **Glue (compiler model, one call per component):** a small typed helper in `src/integrations/<capability>.ts`.
   UI components get no glue: they are used directly and their contract test shows how (small models fail most
   when wrapping complex prop types).

### Backup Coder gap filling (T1/T2)

- Only self-contained helper capabilities (`data.*`, `files.*`, `ops.*`, `jobs.*`). Sign-in, authorization,
  security, payments, email and UI gaps are **never** generated; they are reported to the user.
- Two small calls per gap: the module (`src/backup/<capability>.ts`), then its unit tests written against it.
  Header `// turbineh:generated-backup trigger=… model=…`, same verification and Security Pack as everything else.
- Each fill is recorded (catalog flywheel): `catalog/gaps/` locally, `GAPS_DIR` on workers, and in build metrics.

### Corrector (PLAN §4: correcting ↺ max 3)

1. Up to 3 **directed patches** by the compiler model, only on generated files named in the failing log (a failing
   generated test is corrected together with its module). Recipe code and contract tests are never edited.
2. Between patches a **quick check** (lint, typecheck, unit; no network) runs instead of a full verification; a
   **full verification** always runs before anything is accepted.
3. **Granular swap:** optional parts named in the log are removed one by one (a glue helper — the library and its
   contract test stay; a Backup Coder fill — its capability becomes a reported gap).
4. **Full swap:** back to the assembled commit (all integrations and fills removed and reported).
5. **T4:** if the build is still red, the Backup Coder patches the remaining generated files once.
6. Otherwise the build fails honestly; nothing is delivered red.

### Other triggers

- **T5:** if the compiler cannot produce a valid BuildSpec after its retries, the same decomposed compilation runs
  once on the Backup Coder's primary model.
- **T3:** not triggered in the beta: all glue is deterministic (entities) or a single small helper. Acceptance
  criteria that need business logic beyond the recipe are reported as "Not verified automatically".
- **T6:** unclassified platform errors fail the build with the reason recorded; no model is asked to guess.

## Consequences

- Builds use approved external libraries for real instead of reporting "integration pending".
- A new lockfile means a new sandbox base image the first time (cached afterwards per lockfile hash).
- Every model-written file is marked, tested and verified; metrics record integrations, Backup Coder activations
  (trigger, model, tokens), corrections and swaps.

## Addendum (2026-10-11, after Gate G2)

- The benchmark showed `jobs.queue` as the most frequent gap (6/15 builds) and the Backup Coder's module for it
  rarely passed. Following the flywheel, it became a native catalog component (`jobs.queue.turbineh`, vendored with
  provenance from `catalog/components/<id>/files/`, copied by the assembler only when selected).
- Libraries without bundled TypeScript types failed `typecheck` deterministically. Manifests now declare
  `integration.types` (exact DefinitelyTyped version, ≥ 14 days old), installed as a devDependency with the
  component. Contract-test certification now also type-checks every contract with the apps' strict settings (a
  library without types and without `integration.types` is not approved); all 52 external components were
  re-certified (`bench/results/2026-10-11-certify-recertify-typecheck.json`).

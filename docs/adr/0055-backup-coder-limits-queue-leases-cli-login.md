# ADR-0055 · Backup Coder limits, queue leases, CLI login without the shell history, gate reports in the package

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: an external audit of a generated app (findings F07, F08, F09, F19, F22).
  - **F09.** The Backup Coder hand-wrote `src/backup/jobs-scheduler.ts` (Invalid Date and past dates, tests green)
    although the catalogue has two approved `jobs.scheduler` components (`jobs.scheduler.croner`,
    `jobs.scheduler.cron-parser`). Cause: the selector kept a candidate only when the decider's "covers" answer was
    ≥ 0.5. For "running tasks at scheduled times" the decider answered no for both (cron-parser "does not execute
    jobs", croner "does not persist schedules"), so the capability got trigger T2, the resolver had nothing to
    resolve, and `fillGap` accepted every `jobs.*` gap (`packages/integrator/src/gaps.ts`, `FILLABLE`). Nothing
    checked that an approved manifest declares the capability.
  - **F08.** The Backup Coder wrote a 32-bit string hash for idempotency keys (`hashResult("Aa") ==
hashResult("BB")`). `ops.idempotency` was fillable as a pure helper, which cannot give the guarantee at all.
  - **Labelling.** COMPONENTS.md and the report said Backup Coder code "passed the same verification", which reads
    as verified; it is not catalogue-verified.
  - **F07.** `jobs.queue.turbineh` set `status = 'running'` with no lease: a runner that crashed left the job
    `running` forever, and a slow runner could overwrite the result of another.
  - **F22.** The CLI guide recommended `turbineh login <token>` (the token stays in the shell history and the process
    list) and `curl … | sh` with no version pin or checksum.
  - **F19.** The delivered ZIP had no gate logs, no SBOM and no attestation; `static`, `dependencies` and `licenses`
    showed 0 ms with no explanation; dev-tool advisory GHSA-vfj7-8cjw-p6xm (`braces`).

## Decision

### 1 · The catalogue's coverage is declared by manifests, not by the decider (F09)

- Selector (`packages/selector/src/select.ts`): when no candidate meets `coversMin` but approved candidates declare the
  capability in `relations.provides` and none is risky (`risk ≤ riskMax`), they are ranked anyway (decider order) and
  the decision is marked `catalogueFallback`. Only a risk answer can keep an approved provider out. Selection cache
  version bumped to 2.
- Hard rule in code (`backupMayFill`, `fillGap`): the Backup Coder never fills a capability that any approved
  component provides, even if the resolver could not use that component in this build (peer, licence, conflict).
  `fillGap` throws `CataloguedCapabilityError`; the pipeline filters with the set of approved `provides`. Such a gap
  is reported as not covered.

### 2 · Deterministic output policy for the Backup Coder (F08)

`packages/backup-coder/src/policy.ts`, applied inside `BackupCoder.fill` to every slot (T1–T4, glue): output with a
non-cryptographic hash (`(h << 5) - h`, `h * 31`, `Math.imul`, djb2/FNV/murmur/CRC constants, char codes folded with
bit operations, `md5`/`sha1`) or demo/placeholder code ("for demo purposes", "in a real app", "not implemented",
"placeholder logic", "simplified version", …) is refused (`BackupPolicyError`): the secondary gets one try, then the
gap fails and is reported as not covered. For T4 corrections, text already in the file being corrected is not held
against the model. Capabilities whose guarantee needs persistence and a unique constraint (`idempot`, `dedup`,
`exactly-once`) are never fillable (`needsPersistence`): a pure helper cannot provide them.

### 3 · Backup Coder output is labelled "not catalogue-verified"

COMPONENTS.md ("Written by the Backup Coder — NOT catalogue-verified"), TURBINEH_REPORT.md (new section "Backup Coder
code — not catalogue-verified", business rules, next steps), `turbineh.json` (`backup[]` with
`catalogueVerified: false`), AGENTS.md (gate section) and the plan's "what is left".

### 4 · Queue leases (F07)

`jobs.queue.turbineh`: columns `lease_until`, `heartbeat_at`, `lease_token`. A claim sets a 60 s lease and
increments `lease_token` (fencing token). A heartbeat every 20 s renews the lease while the handler runs; if the
renewal finds a newer token, the handler's `ctx.signal` is aborted. Completion and failure are written only while the
token matches (`lost` counts the others). Each run first fails stale `running` jobs without attempts left
(`LeaseExpired`), then claims due jobs and stale ones with attempts left. Storage is behind a `JobStore` interface so
the behaviour is tested without a database; the rules are the component's acceptance contract (`acceptance.yaml`).

### 5 · CLI login and installer (F22)

- `turbineh login`: hidden prompt on a terminal (raw mode, no echo), `--with-token` reads stdin (refused on a
  terminal), or `TURBINEH_TOKEN`. A positional token still works for now with a deprecation warning on stderr.
- Release artefacts: the CLI build writes `turbineh-<version>.mjs`, `SHA256SUMS` and `release.json` next to
  `turbineh.mjs` (served under `/cli/`). `install.sh` pins the version and its SHA-256 (from `release.json`, traced into
  the function), verifies the download with `sha256sum`/`shasum` before installing, leaves nothing behind on a
  mismatch, and fails closed (503, `exit 1`) when no release is published. The guide shows download, then run.

### 6 · Gate reports in the package (F19)

`verify()` writes `.turbineh/reports/` into the package (committed, so it is in the ZIP): `gate.json` (steps with a
`note` for every step without its own duration, `skipped` steps with the reason), `static.sarif` (SARIF 2.1.0 of the
Semgrep findings), `dependencies.json` (every lockfile package with purl and production/development scope) and, when
the runners produced them, `unit.junit.xml` (vitest) and `e2e.junit.xml` (Playwright). `static` and `dependencies`
now report the shared scan duration. No CycloneDX generator runs in the sandbox (pnpm 10 has no `sbom` command), so
the SBOM is the lockfile dependency list; no attestation is produced yet.

`braces`: GHSA-vfj7-8cjw-p6xm affects every version up to 3.0.3 (`last_affected`), and 3.0.3 is the latest
published version: no fixed version exists to bump or override to. In the recipe templates it is reachable only via
`@next/eslint-plugin-next → fast-glob → micromatch` (lint, development scope), which the gate already reports as a
non-blocking development alert. Bump the templates when braces publishes a fix.

## Consequences

- Fewer gaps reach the Backup Coder; more capabilities show as "not covered" rather than as unverified code.
- Generated apps with the queue get a schema change (three columns, one index), generated by `db:generate` in the
  sandbox as before.
- Old installs keep working (`/cli/turbineh.mjs` is still served); `turbineh login <token>` keeps working, with a
  warning.

# ADR-0034 · Zero-friction packages: local database, required-only env, E2E-owned URLs, proven criteria

- Status: accepted (2026-10-13)
- Context: Frontiers shop rerun after #75–#79 (`bench/frontiers/ANALYSIS.md` §8 on `wip/frontiers-bench`). With our
  package the coding agent still installed `embedded-postgres` by hand to run migrations and E2E (≈ 10 tool calls),
  made `ADMIN_EMAILS` optional because `pnpm build` failed without it, patched `playwright.config.ts` after an ambient
  `BETTER_AUTH_URL` broke sign-in, and wrote the test for the one criterion we left unproven (admin stock change).
  Owner priority: TurbineH plugs into a coding agent's flow with zero extra work; every fix applies to all current and
  future recipes and is enforced by `pnpm catalog:validate` where it can be checked mechanically.

## Decision

### R2 · Zero-setup local database (every package)

- The base template ships `scripts/local-db.ts`. `pnpm db:migrate`, `pnpm dev` and `pnpm test:e2e` run through it;
  `pnpm db:local` serves the persistent local database (`.turbineh/local-db`, git-ignored) on the `DATABASE_URL` of
  `.env.example` (`127.0.0.1:54329`). When `DATABASE_URL` is unset (or equals that value) it prints one line saying so
  and uses the local database; any other `DATABASE_URL` (environment, `.env.local`, `.env`) is used unchanged. In
  production (`NODE_ENV=production`) it refuses to stand in for `DATABASE_URL`.
- `pnpm test:e2e` without `DATABASE_URL` gets a **fresh** database for the run, migrated first, and builds the app when
  there is no production build yet: `pnpm db:migrate && pnpm test:e2e` works with nothing installed.
- Engines, both pinned dev dependencies, chosen by code:
  - **PostgreSQL 17 binaries** (`embedded-postgres` 17.10.0-beta.17, MIT; the `-beta.N` suffix is the wrapper's own
    versioning for every release — the binaries are the stable PostgreSQL 17.10 release; published 2026-06-05) on
    Linux x64/arm64 and macOS. Real PostgreSQL: several connections, real locks and transactions, our migrations run
    unchanged. pnpm runs no dependency scripts, so the script restores what the wrapper's install script would do
    (exec bits, library links).
  - **PGlite** (`@electric-sql/pglite` 0.5.8 + `pglite-socket` 0.2.11 + `pglite-pgvector` 0.0.9, Apache-2.0;
    PostgreSQL 17 in WebAssembly over the wire protocol) when the schema needs pgvector (recipe `ai-agents`), when
    running as root (PostgreSQL refuses root) or when no binary exists for the platform. `LOCAL_DB_ENGINE` forces one.
    PGlite is one session shared by every connection: a query on a second connection waits while a transaction is open
    on another. The base auth hook therefore reads through the surrounding transaction (`getCurrentAdapter`), which is
    also the correct behaviour on PostgreSQL.
- Rejected: Docker (absent in the bench container and in many agent sandboxes); PGlite alone (the transaction wait
  above makes legitimate code hang, the worst failure for an agent); downloading binaries at run time (network, no
  pinning).

### R3 · Build and test with only the documented required env

- Allow-lists (`ADMIN_EMAILS`, `*_DOMAINS`, `ALLOWED_*`) are optional (`.default("")`) and deny by default at runtime
  (storefront, landing-waitlist and corporate-site were required).
- The gate runs `pnpm build` and `pnpm test` with only the variables `src/env.ts` requires (`requiredEnv`): everything
  else the verifier provides is unset for those steps. `SYNTHETIC_ENV` no longer carries `ADMIN_EMAILS` (E2E sets its
  own). The base unit test `tests/unit/env.test.ts` parses `src/env.ts` with only its required variables.
- `catalog:validate`: `required-allow-list` (an allow-list is required) and `required-env-undocumented` (a required
  variable is missing from `.env.example`).

### R4 · E2E owns its URLs

- `playwright.config.ts` picks a free port once (inherited by workers through `E2E_PORT`) and sets `BETTER_AUTH_URL`,
  `APP_URL` and `PORT` to it unconditionally; ambient values are ignored. Without `DATABASE_URL` it stops with one line
  pointing at `pnpm test:e2e`.
- The gate's own environment carries `BETTER_AUTH_URL=http://localhost:3000` on purpose, so every verified build
  proves an ambient value does not break E2E. `catalog:validate`: `e2e-ambient-url`.

### R5 · Every criterion proven by a shipped test, or open with where to prove it

- Every recipe ships `acceptance.yaml` (criteria → tests by regex, ADR-0033), saas-crud's applies to all.
  Generated entities add rules for their generated tests (create / edit / CSV export / CSV import).
  `catalog:validate`: `acceptance-missing` (no file in the chain) and `acceptance-test-missing` (a rule points at a
  test title that the template or component does not ship, or has an invalid regex) — it found two stale references in
  `domain.bookings.turbineh` / `ai.orchestrator.turbineh`, fixed here.
- After verification a criterion is **met** only with a test that exists in the package and a passed gate: the
  deterministic rule first, then the report's mapping when it points at a test. Evidence that is not a test ("strict
  type checking") no longer verifies a criterion. Open criteria list the files to change and the spec file where the
  test belongs. `ACCEPTANCE.md`, `.turbineh/acceptance.json`, `AGENTS.md`/`turbineh.json` and the report say the same.
- Storefront: stock is shown on the product page (units left, per option), and
  `tests/e2e/shop.spec.ts › the admin updates a product's stock and the public catalogue reflects it at once` proves it.

## Consequences

- AGENTS.md "What to re-run" says E2E needs no setup, adds `pnpm db:local`, and uses `pnpm test:e2e <spec> -g` (which
  brings the database) instead of `playwright test`.
- `verify:recipe --local-db` runs the gate with no Postgres container and no `DATABASE_URL` for migrations and E2E
  (exactly what an agent without PostgreSQL runs); `--assemble-only` prints the assembled package.
- Every package carries both engines as dev dependencies (only the current platform's binary is installed).
- Semgrep `turbineh.no-child-process` excludes `scripts/local-db.ts` (a development tool, never served).

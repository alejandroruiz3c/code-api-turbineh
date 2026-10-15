# ADR-0011 · Sandbox and verification gate

- Status: accepted
- Date: 2026-10-10
- Context: PLAN §1.6, §5.2, §5.4; CLAUDE.md (never run third-party code outside an ephemeral sandbox without secrets)

## Decision

- **Image:** `services/sandbox/Dockerfile` (Playwright 1.63 / Node 24, pinned by digest, pnpm 10.33.0, non-root user).
- **Dependencies:** every recipe has a committed lockfile. Packages are downloaded once into a shared pnpm store
  volume (the only step with internet access, used only to fetch packages). pnpm does not run dependency build
  scripts.
- **Offline phase (`--network none`):** install (`--offline --frozen-lockfile`), migration generation, typecheck,
  lint, unit tests, production build. Synthetic configuration only; no real secret ever enters a sandbox.
  Resource limits: memory, CPUs, PIDs, `no-new-privileges`.
- **E2E phase:** a per-build Docker network created with `--internal` (no internet) with an ephemeral Postgres;
  migrations + Playwright smoke. Network and database are removed afterwards.
- **Read-only scans (no package code executed):** gitleaks on the generated git tree; OSV on every lockfile package
  (direct + transitive), classified as production or development scope; licenses of all installed packages.
- **Blocking rules:** any failed step; any secret; HIGH/CRITICAL advisory in the production tree; copyleft or
  unlicensed packages. Development-only advisories are reported as not reachable at runtime.

## Consequences

- Recipe templates must not need native binaries with restrictive licenses: `sharp` is excluded and image
  optimization disabled (also removes the optimizer's network surface).
- E2E tests reuse one signed-up session (Playwright setup project) so the auth rate limiter stays enabled.

# ADR-0022 · Separate staging and production

- Status: accepted (owner decision, 2026-10-12)
- Date: 2026-10-12

## Context

Until now one environment served both purposes: `software.turbineh.com` (real users) also received every merged
change and every benchmark run.

## Decision

| Piece     | Production                                                             | Staging                                                                                       |
| --------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Web/API   | Vercel `code-frontiers-web`, `software.turbineh.com`                   | Vercel `code-frontiers-web-staging`, `staging.software.turbineh.com`                          |
| Database  | `rdb` instance, database `rdb`                                         | same instance, database `turbineh_staging`                                                    |
| Artefacts | bucket `code-frontiers-artifacts`                                      | bucket `code-frontiers-artifacts-staging`                                                     |
| Worker    | `turbineh-worker`, `/opt/code-api-turbineh`                            | `turbineh-worker-staging`, `/opt/code-api-turbineh-staging`, concurrency 1, cost cap 20 €/day |
| Secrets   | `/etc/turbineh/worker.env`, `STAGING_*` (legacy names) in `.env.local` | `/etc/turbineh/worker-staging.env`, `STG_*` in `.env.local`                                   |

- Flow: merge → `infra/staging/deploy.sh staging` → smoke build → `infra/staging/deploy.sh production` (only from a
  clean `main`). Benchmarks run against staging by default.
- Cost: no new paid resources (database inside the existing instance, worker on the existing host). Both workers
  share the host (8 GB): at most one build each at a time.
- Separate auth secrets, delivery key and API keys: a staging session or key never works in production.
- Staging login with GitHub needs its own GitHub OAuth app (one callback domain per app): `STG_GITHUB_CLIENT_ID/
_SECRET`. Until it exists, staging is used through the API with `STG_SMOKE_API_KEY`.

## Follow-ups

- The OVH worker (when available) joins production as an extra worker; staging stays on Scaleway.

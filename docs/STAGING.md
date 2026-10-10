# Staging runbook

| Piece            | Where                                                                                       | How to (re)create                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Web + public API | Vercel project `code-frontiers-web` (team turbineh), region `cdg1`, `software.turbineh.com` | `npx tsx infra/staging/web.ts all`, then `vercel deploy --prod` from the repo root                                                    |
| Worker + sandbox | Scaleway `code-frontiers-staging` (fr-par-1)                                                | `npx tsx infra/staging/provision.ts instance`; `infra/staging/setup-host.sh` over SSH; rsync the repo; `infra/staging/worker.service` |
| Database         | Scaleway managed PostgreSQL 16 (pgvector), TLS verified with the instance CA                | `npx tsx infra/staging/provision.ts db`; `pnpm db:migrate`, `auth:migrate`, `catalog:sync` against it                                 |
| Artefacts        | Scaleway Object Storage bucket `code-frontiers-artifacts` (private; signed URLs)            | `npx tsx infra/staging/provision.ts bucket`                                                                                           |

Secrets: never in git. Local values in `.env.local`; worker values in `/etc/turbineh/worker.env` (mode 600);
web values as encrypted Vercel environment variables. See [SECRETS.md](SECRETS.md).

Capacity note: the Scaleway account currently allows only `DEV1-L` instances (4 vCPU, 8 GB). Builds run one at a
time (`WORKER_CONCURRENCY=1`, sandbox 3 GB). A quota increase is needed for launch-day throughput (ADR-0006).

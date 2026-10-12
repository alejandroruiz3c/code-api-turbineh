# Environments runbook (production and staging)

Two separate environments since ADR-0022. The tables below describe **production** (`software.turbineh.com`);
staging mirrors it with its own pieces:

| Piece            | Staging                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Web + public API | Vercel `code-frontiers-web-staging`, `staging.software.turbineh.com` (`TARGET=staging npx tsx infra/staging/web.ts all`) |
| Worker           | same host, unit `turbineh-worker-staging`, `/opt/code-api-turbineh-staging`, `/etc/turbineh/worker-staging.env`          |
| Database         | database `turbineh_staging` in the same managed instance (`provision staging-db`)                                        |
| Artefacts        | bucket `code-frontiers-artifacts-staging` (`provision staging-bucket`)                                                   |
| Smoke API key    | `STG_SMOKE_API_KEY` (`TARGET=staging npx tsx infra/staging/api-key.ts`)                                                  |

**Operations panel:** `/ops` (and `GET /v1/ops`) shows throughput, green rate, queue, workers and cost; only the
emails in `OPS_ADMIN_EMAILS` (session) and the API-key owners in `OPS_OWNER_IDS` see it. Cost is never shown to clients.

**AI gateway (ADR-0029):** client AI apps call `/v1/ai/v1/*` with their app token; the web app forwards with our
model-provider and JEV keys (`AI_GATEWAY_*` in Vercel, set by `infra/staging/web.ts env`). Revoke an app's token to
stop it; usage per app is in `/ops`.

**Release flow:** merge the PR → `infra/staging/deploy.sh staging` → smoke build on staging →
`infra/staging/deploy.sh production` (refuses anything but a clean `main`). Each run syncs the code, builds the
worker, applies migrations, restarts the unit, deploys the web and checks `/health`.

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

## Deploying a new version of the worker

```bash
rsync -az --delete --exclude node_modules --exclude .git --exclude '.env*.local' --exclude /builds \
  --exclude /artifacts --exclude .next --exclude .turbo --exclude .vercel ./ root@<worker>:/opt/code-api-turbineh/
ssh root@<worker> 'cd /opt/code-api-turbineh && chown -R turbineh:turbineh . \
  && sudo -u turbineh pnpm install --frozen-lockfile && sudo -u turbineh pnpm turbo build --filter=@turbineh/worker... \
  && systemctl restart turbineh-worker'
```

Worker-only settings in `/etc/turbineh/worker.env` besides the keys: `WORKER_CONCURRENCY`, `SANDBOX_MEMORY`,
`SANDBOX_CPUS`, `DAILY_COST_CAP_EUR`, `REPORT_WRITER_MODEL` (default `glm-5.2`) and `GAPS_DIR`
(`/var/lib/turbineh/gaps`: Backup Coder flywheel records, outside the deployed tree because deploys replace it).
The sandbox image `turbineh/sandbox:1` (`services/sandbox/Dockerfile`) is built by `deploy.sh` on a new host when missing; a worker without it fails every build at `install`. Sandbox base images (`turbineh/sandbox-base:<lockfile hash>`) are built on first use and reused.

## Benchmark against staging

`pnpm bench` sends `bench/prompts/*.json` one by one to `software.turbineh.com` with a dedicated API key
(`BENCH_API_KEY`, or `STAGING_SMOKE_API_KEY` in `.env.local`) and writes `bench/results/<date>-benchmark.{json,md}`.

# ADR-0002 · Stack and version pinning

- Status: accepted (platform tooling); generated-app stack versions are fixed in D1 (WP7)
- Date: 2026-10-10

## Rule

Exact versions only (`save-exact=true`), stable releases published **more than 14 days ago**
(cut-off for this ADR: 2026-09-26). Lockfile committed; CI installs with `--frozen-lockfile`.

## Platform tooling (this repo)

| Tool                | Version                                                      | Published               | Note                                                                      |
| ------------------- | ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------- |
| Node.js             | 24 (CI)                                                      | LTS                     | Local dev verified on Node 25                                             |
| pnpm                | 10.33.0                                                      | —                       | `packageManager` field                                                    |
| turbo               | 2.11.4                                                       | 2026-09-24              |                                                                           |
| typescript          | 6.0.3                                                        | 2026-04-16              | 7.x not used: typescript-eslint 8.70 requires `<6.1`                      |
| eslint / @eslint/js | 10.11.0 / 10.0.1                                             | 2026-09-18 / 2026-02-06 |                                                                           |
| typescript-eslint   | 8.70.1                                                       | 2026-09-21              |                                                                           |
| prettier            | 3.9.9                                                        | 2026-09-23              |                                                                           |
| vitest / vite       | 5.0.2 / 8.3.1                                                | 2026-09-25 / 2026-09-24 |                                                                           |
| tsx                 | 4.23.15                                                      | 2026-09-20              |                                                                           |
| zod                 | 4.6.5                                                        | 2026-09-13              |                                                                           |
| ajv / ajv-formats   | 8.20.0 / 3.0.1                                               | 2026-04-24 / 2024-03-30 |                                                                           |
| yaml                | 2.9.1                                                        | 2026-09-11              |                                                                           |
| @typesafe-ai/sdk    | 0.6.0                                                        | 2026-09-15              | Official JEV SDK (MIT)                                                    |
| openai (npm client) | 7.23.0                                                       | 2026-09-23              | Used **only** as an OpenAI-compatible HTTP client for open-weights models |
| GitHub Actions      | checkout v7.0.1, setup-node v7.0.0, pnpm/action-setup v6.1.0 | pinned by SHA           |                                                                           |
| gitleaks            | 8.30.1                                                       | 2026-03-21              | Checksum-verified in CI                                                   |

## Generated-app stack (beta, PLAN §3.5)

Next.js (App Router) + strict TypeScript + Tailwind + shadcn/ui + Drizzle + Postgres + open auth library + Zod.
Exact versions are selected and frozen in WP7 when recipe 1 compiles and passes the E2E smoke.

## Exceptions (approved at Gate G0, 2026-10-10)

| Item                                  | Published  | Why                                                                                                    |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `quyet==1.0.2` (open decider runtime) | 2026-10-08 | Quyet 1.0 itself was released 2026-10-03. It is the open alternative chosen in the project comparison. |

Rationale for the `quyet` exception: it is the open alternative chosen in the project comparison, it is pinned
exactly, and JEV is the primary decider, so Quyet only serves as fallback. Re-check on 2026-10-22 (14 days after
1.0.2) and pin the latest release older than 14 days at that point.

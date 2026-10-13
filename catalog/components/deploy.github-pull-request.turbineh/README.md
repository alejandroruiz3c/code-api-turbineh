# deploy.github-pull-request.turbineh — integrate into an existing repository as a verified pull request

TurbineH platform service (not code copied into an app). Decision record: `docs/adr/0032-github-integration-repo-analysis.md`.

## What it does

1. **Connect GitHub** to a workspace — optional, only needed to integrate into a repository.
2. **Analyse** the chosen repository with [`ops.repo-analysis.turbineh`](../ops.repo-analysis.turbineh/README.md).
3. **Adapt** the generated capability package to the project: own folder in the project's source root
   (`src/turbineh/<capability>/`, or `apps/web/src/turbineh/<capability>/` in a monorepo), relative imports
   inside it and the project's alias for its own modules, reuse of the project's Drizzle client, Security Pack
   basics copied only if imported, dependencies merged with exact versions (existing versions never changed),
   settings added to `.env.example` by name, tables registered in the project's Drizzle schema.
4. **Generate with the project's own tools in the sandbox**: lockfile update (pnpm/npm/Yarn classic) and the
   database migration (the project's drizzle-kit config, or a SQL migration in the capability folder).
5. **Commit one logical step per commit** on `turbineh/<capability>` and open a **draft pull request** whose body has:
   summary, the project as analysed, decisions and why, differences found, files, commits, verification, limits,
   what the reviewer must configure and how to revert.
6. **Verify the PR head inside the project** in the sandbox: install, install scripts, type check, lint, the
   project's tests, the capability's tests, migration applied to an empty PostgreSQL, production build, plus
   "only planned files changed" and "no secrets in the changes".
7. **Ready for review + state `integration_verified` only when every check passes.** Otherwise the PR stays a draft
   and lists each failure with its cause and the next step. Nothing is ever merged.

The reviewer's remaining work is exactly the "What you must configure" list in the PR (real settings values, applying
the migration in their environments, wiring the capability where they want it — documented in
`<capability>/agent/INTEGRATE.md`).

## When to use it / when not

| Use it when                                                                                                  | Do not use it when                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| The user has a Next.js (15+) / TypeScript or JavaScript project on GitHub and wants the capability inside it | The project is on GitLab/Bitbucket or local only → `turbineh apply` (local branch) or the ZIP                                    |
| The reviewer wants a ready-to-review PR with evidence instead of instructions                                | The project uses Bun or Yarn Berry, a private npm registry or git/URL dependencies (the sandbox cannot install them; it says so) |
| An agent needs a verified hand-off it can continue from                                                      | The database is MySQL/SQLite/Mongo and the capability has PostgreSQL tables (reported as incompatible)                           |

## Interfaces

| Who                         | How                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser (invitation cookie) | `GET /api/github/connect?private=0\|1&return=/flows/new` → GitHub → `GET /api/auth/callback/github/workspace`                                                                                                                                     |
| CLI                         | `turbineh connect github [--private]` (opens the same flow, code shown on both sides) · `turbineh connect github --with-token` (token on stdin) · `turbineh disconnect github` · `turbineh apply <plan> --pr [--repo owner/name] [--base branch]` |
| API                         | `GET/DELETE /v1/github` · `POST /v1/github/connect` · `POST /v1/github/token` · `GET /v1/repos?q=` · `POST/GET /v1/plans/{id}/pull-request`                                                                                                       |

Job phases: `queued → analysing → adapting → preparing → committing → verifying → done | failed`.
States: `integrated` (PR open) → `integration_verified` (checks passed in the project).
Errors are `{code, message, action, resume}`: `github_not_connected`, `package_not_ready`, `repo_required`,
`no_write_access`, `incompatible_project`, `integration_not_verified`, `github` (rate limit, revoked access…).

## Configuration

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`: the existing GitHub OAuth app. Its callback URL must be the app's
  `/api/auth/callback/github` (the connect callback lives under it at `/workspace`).
- `DELIVERY_TOKEN_KEY`: 32-byte base64 key, AES-256-GCM encryption of tokens at rest (web and worker).
- `PRODUCT_APP_URL` (worker, optional): links the PR to the flow page.
- Worker: Docker with `turbineh/sandbox:1`; the adaptation model uses the Backup Coder slots (GLM-5.2 first).

## Limits

- OAuth states and CLI links: one use, 10 minutes. Scopes: `public_repo`, or `repo` only when the user asks for
  private repositories (the UI explains why).
- Install phase has network for the package manager only (npm registry pinned, install scripts disabled); there is
  no egress firewall, so the guarantee comes from no third-party code running while networked.
- Checks use placeholder settings and a throwaway PostgreSQL: real credentials and third-party services are not
  exercised. Pages/routes wiring is left to the reviewer or their coding agent (documented).
- GitHub Free private repositories cannot have draft PRs: the PR is titled `[Draft] …` until verified.

## Security guarantees and the tests that prove them

| Guarantee                                                                                    | Test                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Callback requires the returned state to equal the httpOnly cookie (login CSRF)               | `apps/web/src/server/github-oauth.test.ts` › rejects a state without the matching cookie               |
| State is single-use and expires; only its SHA-256 is stored                                  | same file › one use, hash only                                                                         |
| Connection bound to the workspace that started it (CLI tickets bound by the one-time ticket) | same file › wrong workspace refused; ticket flow                                                       |
| PKCE S256: verifier stored encrypted, sent only in the server-side exchange                  | same file › PKCE challenge/verifier                                                                    |
| Token encrypted at rest (AES-256-GCM), never returned by `GET /v1/github`                    | same file › encrypted save, public view without token                                                  |
| Minimal scopes (`public_repo` unless private requested)                                      | same file › scopes                                                                                     |
| Unrelated files never changed; dependency versions never changed or downgraded               | `packages/engine/src/repo-integration.test.ts` › adaptation; worker check "Only planned files changed" |
| Env files/keys never read; secret canary never reaches output                                | `packages/engine/src/repo-integration.test.ts` › analysis; `sanitizeProject` in the worker             |
| Real end-to-end: PR opened, verified, `integration_verified`                                 | `apps/worker/src/repo-integration.e2e.test.ts` (opt-in, real throwaway repository)                     |

## Search keywords

github, pull request, PR, merge request, integrate into existing repository, existing codebase, brownfield, add
feature to my app, connect repository, connect GitHub, OAuth, PKCE, monorepo, Next.js, App Router, Pages Router,
Drizzle, migration, lockfile, verify in project, code review, coding agent hand-off, Claude Code, Codex.

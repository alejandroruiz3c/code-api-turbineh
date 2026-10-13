# ops.repo-analysis.turbineh — analyse an existing repository (stack, conventions, conflicts)

TurbineH platform service (not code copied into an app). Decision record: `docs/adr/0034-github-integration-repo-analysis.md`.

## What it does

Reads a GitHub repository **through the API, without cloning**: the file list, root manifests, up to 40 workspace
`package.json` files and the application's configuration (tsconfig, next.config, drizzle.config, prisma schema,
components.json, test/lint configs, `.env.example`). From that, deterministically:

- **Application**: root or the Next.js app of a monorepo (`apps/web` preferred), turborepo/nx/pnpm/npm workspaces.
- **Stack**: framework and version, App Router / Pages Router / both and their folder, `src/` or root layout,
  TypeScript (strict?) or JavaScript, ESM/CJS, Node version.
- **Conventions**: import aliases (`@/*`, `~/*`…), package manager and lockfile, Tailwind version, UI libraries
  (shadcn/ui, Radix, MUI…), lint/format (ESLint, Biome, Prettier), test runner (vitest/jest, Playwright/Cypress),
  scripts present (build, lint, typecheck, test), CI files.
- **Data and auth**: ORM (Drizzle, Prisma, TypeORM, Kysely…), its schema entry, migrations folder and the module
  exporting the database client; database (PostgreSQL, MySQL, SQLite, MongoDB); auth library (better-auth,
  NextAuth/Auth.js, Clerk, Lucia, Supabase…).
- **Env files by name only** (`.env.local` is listed, never read).

`analysisFindings` then states, for one capability: compatibility, conflicts (old Next.js, non-PostgreSQL database,
another ORM, another auth library, major-version differences) and adaptation decisions with the reason (placement,
imports, database reuse, router, tests). Plans carry it as `plan.repository`; the PR repeats it.

## When to use it / when not

| Use it when                                                                                                                | Do not use it when                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Planning a capability for an existing GitHub project (UI "Connect a repository", `POST /v1/plans` with `environment.repo`) | The project is not on GitHub → upload manifests (`environment.files`) or `turbineh plan` locally |
| You want to show the user what was found before generating                                                                 | You need semantic code understanding (call graphs, business rules): out of scope by design       |
| An agent needs a machine-readable profile of a repository                                                                  | Non-JS/TS projects: you get an honest incompatibility, not an adaptation                         |

## Interfaces

- `GET /v1/repos/{owner}/{name}/analysis?ref=<branch>&app=<path>` → `{repo, private, can_push, default_branch, analysis, conflicts, decisions, compatible}`
- `POST /v1/plans` with `environment.repo {provider: "github", fullName, ref?, appPath?}` → `plan.repository`
- Library (`@turbineh/engine`): `analyseGitHubRepo`, `analyseRepo`, `firstReadList`, `secondReadList`,
  `pickAppPath`, `analysisFindings`, `repositoryFit`, `aliasFor`, `namespaceDir`, `isReadable`.

## Configuration

None. Public repositories work anonymously (GitHub rate limits apply); private ones use the workspace's GitHub
connection ([`deploy.github-pull-request.turbineh`](../deploy.github-pull-request.turbineh/README.md)).

## Limits

- GitHub may truncate the tree of very large repositories (stated in `conventions`).
- Files over 300 KB are skipped. Computed config values (e.g. a schema path built in code) are reported as unknown.
- The database-client module is found among `db|database|drizzle` modules in `src/`, `lib/`, `server/`.

## Security notes and the tests that prove them

| Guarantee                                                                                                                                                               | Test                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Never asks for `.env*` (except `.env.example/.sample/.template`), keys, `.npmrc`, `.yarnrc`, `.netrc` or build output; the reader refuses them whatever the caller asks | `packages/engine/src/repo-integration.test.ts` › "never asks for env files, keys or build output" |
| A secret placed in `.env.local`/`.env` of a fixture never appears in the analysis                                                                                       | same file › App Router with src/ and without src/ (secret canary)                                 |
| Correct detection on four real layouts (App Router + src, App Router at root, Pages Router, turborepo)                                                                  | same file › "repository analysis on real layouts"                                                 |
| Conflicts and decisions are deterministic and explained                                                                                                                 | same file › "findings: conflicts and decisions with reasons"                                      |
| The token is sent only as an Authorization header and never echoed in errors                                                                                            | same file › "GitHub client"                                                                       |

## Search keywords

analyse repository, analyze repo, detect stack, project conventions, codebase profile, monorepo app path, App
Router, Pages Router, src directory, path alias, tsconfig paths, package manager, lockfile, Drizzle, Prisma, ORM
detection, auth detection, NextAuth, Clerk, better-auth, Tailwind version, test runner, CI, compatibility check,
conflicts, existing project, brownfield.

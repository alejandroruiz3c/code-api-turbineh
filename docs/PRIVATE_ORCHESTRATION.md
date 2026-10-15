# Private packages (orchestration engines)

TurbineH's orchestration (the server side of component #001, `ai.orchestrator.turbineh`) is proprietary and lives
outside this public repository (ADR-0053), in its own private repository, consumed at a pinned release (ADR-0057). This
repository contains its interface and an open minimal fallback in `packages/orchestration`; everything builds, tests
and runs without the private engine.

The resource decision engine (which recipe, capabilities, components, app, scope, rules and evidence a build uses, and
the AI gateway's hedging policy) follows the same mechanism (ADR-0058): interface, public decision API client and open
minimal fallback in `packages/decider` (`@turbineh/decider`), the engine in the private package `resource-decider`.

## Layout

```
code-api-turbineh/                    public repository
├── packages/orchestration/           @turbineh/orchestration: interface + open fallback (public)
├── packages/decider/                 @turbineh/decider: decision interface + SDK client + open fallback (public)
├── infra/private/versions.json       pins: { repo, tag, commit } per private package (no code)
├── infra/private/sync.sh             checks the pins out into private/<name>
├── private/agent-orchestrator/       checkout of the private agent orchestrator, git-ignored here (proprietary)
└── private/resource-decider/         checkout of the private resource decision engine, git-ignored (proprietary)
```

`infra/private/versions.json` is a map of private packages (`packages.<name>`), each checked out at `private/<name>`:

| Field        | Meaning                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `repo`       | private GitHub repository (`owner/name`)                                                                  |
| `tag`        | pinned release tag (`vX.Y.Z`)                                                                             |
| `commit`     | full commit SHA the tag must resolve to                                                                   |
| `requiredBy` | deploy targets of `infra/staging/deploy.sh` that refuse to deploy without it (`web`, `worker`)            |
| `contract`   | optional: `{ vendored, public }`, a file the package vendors from this repository, compared byte for byte |

The web app picks the engine at build time (`apps/web/orchestration.config.mjs`): when
`private/agent-orchestrator/src/index.ts` exists, `@turbineh/orchestration/engine` is aliased to it (Turbopack and
Vitest); otherwise the open fallback is used. Likewise `apps/web/resource-decider.config.mjs` aliases
`@turbineh/decider/engine` to `private/resource-decider/src/index.ts` (else to the open fallback). The worker resolves
`@turbineh/decider/engine` at startup (Node loader: the private entry by path when present) and logs which edition
decides.

## Setup (operators)

Access to the private repository is required (the GitHub CLI's login is used when available).

```bash
cd code-api-turbineh
infra/private/sync.sh            # clone/fetch and check out every pinned package (idempotent, offline when in place)
infra/private/sync.sh --check    # verify only: present, pinned tag → pinned commit, HEAD, clean, contract in sync
```

Then run the usual checks from the repository root (`pnpm typecheck && pnpm lint && pnpm test`): the web tests run
against the private engine when it is present (`ai-orchestration.test.ts` asserts which one is loaded). The engine's
own checks run in its repository (`pnpm install && pnpm check` inside `private/agent-orchestrator`, or its CI).

Never edit the checkout in place: change the private repository through a PR, release a tag, then update the pin here.

## Releasing a new engine version

1. In the private repository: PR → CI green → merge → bump version, CHANGELOG, annotated tag `vX.Y.Z` (tags are
   immutable).
2. Here: a PR that updates `tag` and `commit` in `infra/private/versions.json` (`infra/private/sync.sh --validate`
   runs in CI). Run `infra/private/sync.sh` and the web tests locally against the new engine.
3. Deploy (below). Roll back by reverting the pin.

An interface change (`packages/orchestration/src/types.ts`) goes here first, then into the engine's vendored copy and
a new release, then the pin: deploys refuse an engine whose vendored contract differs from this checkout's interface.

## Production

- `infra/staging/deploy.sh <staging|production> <web|worker|all>` runs `infra/private/sync.sh --for <target>` before
  deploying anything: it checks out every package the target requires at its pinned tag and commit, verifies the
  checkout is clean and the contract is in sync, prints each version (repository, tag and commit), and refuses to
  deploy otherwise.
- Vercel production builds (`VERCEL_ENV=production`) and any build with `TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1`
  fail when the private engine is missing. `TURBINEH_ALLOW_OPEN_ORCHESTRATION=1` builds the open fallback on purpose.
- `.vercelignore` uploads `private/<name>` without `.git`, `node_modules`, `bench`, `coverage`, `services` and
  `integration` (the legacy `private/orchestration` location is never uploaded). Workers do not need the agent
  orchestrator; they need the resource decision engine (`requiredBy: web, worker`): the rsync ships
  `private/resource-decider`, and the systemd units set `TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1`, so a worker
  without it refuses to start.

## Rules

- Never copy private sources into the public tree, issues, PRs, docs or generated apps; only pins live here.
- The engines have no runtime dependencies and import only types from the public interfaces
  (`packages/orchestration/src/types.ts`, `packages/decider/src/contract.ts`); a change to an interface is made in the
  public repository first, then in the private engine.
- The resource decision engine decides only choices among discrete options; deterministic questions (compatibility,
  licences, permissions, test results) stay public code. Its own checks: `pnpm check` in its repository, and
  `pnpm test:integration` inside `private/resource-decider` (the decision tests through the public sources).
- The gateway (public) keeps authentication, the trial cap, limits, the model allow-list, billing and error mapping;
  the engine only decides and calls models through `EngineIO`.

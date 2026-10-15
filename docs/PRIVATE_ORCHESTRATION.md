# Private orchestration engine

TurbineH's orchestration (the server side of component #001, `ai.orchestrator.turbineh`) is proprietary and lives
outside this public repository (ADR-0053). This repository contains its interface and an open minimal fallback in
`packages/orchestration`; everything builds, tests and runs without the private engine.

## Layout

```
code-api-turbineh/              public repository
├── packages/orchestration/     @turbineh/orchestration: interface + open fallback (public)
└── private/orchestration/      private repository, git-ignored here (proprietary engine)
```

The web app picks the engine at build time (`apps/web/orchestration.config.mjs`): when
`private/orchestration/src/index.ts` exists, `@turbineh/orchestration/engine` is aliased to it (Turbopack and Vitest);
otherwise the open fallback is used.

## Setup (operators)

```bash
cd code-api-turbineh
git clone <private orchestration repository> private/orchestration   # never inside the public history
cd private/orchestration
../../node_modules/.bin/tsc -p tsconfig.json      # typecheck against the public interface
../../node_modules/.bin/vitest run --root .        # engine tests
```

Then run the usual checks from the repository root (`pnpm typecheck && pnpm lint && pnpm test`): the web tests run
against the private engine when it is present (`ai-orchestration.test.ts` asserts which one is loaded).

## Production

- Vercel production builds (`VERCEL_ENV=production`) and any build with `TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1`
  fail when the private engine is missing. `TURBINEH_ALLOW_OPEN_ORCHESTRATION=1` builds the open fallback on purpose.
- `infra/staging/deploy.sh … web` refuses to deploy without `private/orchestration` or with uncommitted changes in it,
  and prints the engine revision it deploys. `.vercelignore` uploads it (without `.git`, `node_modules`, `bench`).
- Workers do not need it.

## Rules

- Never copy private sources into the public tree, issues, PRs, docs or generated apps.
- The engine has no runtime dependencies and imports only types from `packages/orchestration/src/types.ts`; a change
  to that interface is made in the public repository first, then in the private engine.
- The gateway (public) keeps authentication, the trial cap, limits, the model allow-list, billing and error mapping;
  the engine only decides and calls models through `EngineIO`.

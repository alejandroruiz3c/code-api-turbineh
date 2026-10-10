# CODE-API-TURBINEH

Prompt-to-production software generator by TurbineH. Instead of generating a whole app, it **selects** verified
components from a catalog, generates only the glue, verifies everything in a sandbox and delivers a private repo.

> Status: **D0 · foundations** (pre-beta). Not deployed yet. See [docs/PLAN.md](docs/PLAN.md).

## How it works

`prompt → intent (BuildSpec) → selection (decider) → resolution (deterministic) → assembly → verification → delivery`

- **Decider:** JEV by TypeSafe AI or an open alternative (Quyet), behind one interface — [ADR-0004](docs/adr/0004-decider.md).
- **Compiler:** a small open-weights model turns the prompt into a validated `BuildSpec`.
- **Backup Coder:** open-weights coders that fill gaps only — [ADR-0003](docs/adr/0003-backup-coder.md).
- **Security Pack:** injected in every build, no opt-out.

Model policy: open-weights models only, except JEV ([ADR-0001](docs/adr/0001-architecture.md)).

## Repository

```
packages/shared        config (zod-validated env), logger, timing
packages/decider       Decider interface · JevDecider · OpenDecider · FallbackDecider
packages/catalog       component.yaml v0.1 schema + validator + approval gate
packages/compiler      prompt → BuildSpec (open model, constrained JSON)
packages/backup-coder  primary/secondary open coders, triggers T1–T6, catalog/gaps
services/open-decider  Quyet behind the /v1/systemone shape (Python)
catalog/components     component manifests
bench/                 prompts and measured results (the only source of public numbers)
docs/                  plan, ADRs, best practices
```

## Getting started

Requirements: Node 24+, pnpm 10, gitleaks (pre-commit hook), Python 3.12 + uv for the open decider.

```bash
pnpm install                 # also enables the gitleaks pre-commit hook
pnpm db:up && pnpm db:migrate   # local Postgres + pgvector (Docker)
pnpm ingest -- --pages 40 --embed  # seed the discovered catalog layer
cp .env.example .env.local   # fill in; never commit
pnpm build && pnpm test
pnpm lint && pnpm typecheck
pnpm catalog:validate
```

Smoke tests (need the services from `.env.local`):

```bash
pnpm smoke:decider        # 1 Choice + 1 Noul in one request per backend, latency p50/p95
pnpm smoke:compiler       # 5 prompts → valid BuildSpec
pnpm smoke:backup-coder   # both backup slots answer
```

Open decider locally (on demand): `pnpm open-decider` — see [services/open-decider/README.md](services/open-decider/README.md).

## Documentation

- [Product description (source of truth)](docs/PRODUCT_DESCRIPTION.md) · [Plan](docs/PLAN.md) · [Architecture](docs/ARCHITECTURE.md) · [Component manifest](docs/COMPONENT_MANIFEST.md)
- [Decider best practices](docs/DECIDER_BEST_PRACTICES.md) · [ADRs](docs/adr/)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## License

[Apache-2.0](LICENSE). Copyright 2026 Alex Ruiz (TurbineH). As sole copyright holder the owner keeps the right to use,
relicense or commercialise the code in any way.

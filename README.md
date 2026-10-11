# CODE-API-TURBINEH

Prompt-to-production software generator by TurbineH. Instead of generating a whole app, it **selects** verified
components from a catalog, generates only the glue, verifies everything in an isolated sandbox, fixes security
findings before delivery and hands over a complete, verified package with a plain-language report.

> Status: **beta**, live at [software.turbineh.com](https://software.turbineh.com) (web + public API).
> Plan: [docs/PLAN.md](docs/PLAN.md).

## How it works

`prompt → intent (BuildSpec) → selection (decider) → resolution (deterministic) → assembly + integration →
verification (+ corrections) → security remediation → report → delivery`

- **Decider:** JEV by TypeSafe AI behind one interface, with an open fallback; many small questions in one batched
  request ([ADR-0004](docs/adr/0004-decider.md), [best practices](docs/DECIDER_BEST_PRACTICES.md)).
- **Compiler:** a small open-weights model writes the `BuildSpec` in small, validated parts ([ADR-0010](docs/adr/0010-decomposition-principle.md)).
- **Catalog:** approved components only — manifest, contract tests (run and type-checked), OSV scan and allowed
  licence ([ADR-0012](docs/adr/0012-catalog-curation.md)). Five recipes: SaaS CRUD, internal tool, landing + waitlist,
  bookings, client portal.
- **Integration and Backup Coder:** approved libraries are installed at exact versions with their contract tests
  running inside the app; open-weights coders fill only small, self-contained gaps; a corrector patches failing
  generated files and swaps out what cannot be made green ([ADR-0015](docs/adr/0015-integration-backup-coder-corrector.md)).
- **Verification:** sandbox without internet and without secrets — lint, strict typecheck, unit tests, production
  build, end-to-end tests on an ephemeral Postgres, gitleaks, Semgrep with TurbineH rules, OSV, licences
  ([ADR-0011](docs/adr/0011-sandbox-and-verification.md)).
- **Security remediation and report:** findings are fixed before delivery and everything is verified again; the
  user gets `SECURITY.md` and a plain-language `TURBINEH_REPORT.md`, and can ask once for "Improve & redeliver"
  ([ADR-0014](docs/adr/0014-security-remediation-and-report.md)).
- **Delivery:** the complete package (zip + git bundle) and "Push to my GitHub" into the user's own account
  ([ADR-0013](docs/adr/0013-delivery-scope.md)).

Model policy: open-weights models only, except JEV ([ADR-0001](docs/adr/0001-architecture.md)); a closed frontier
model is used only as the benchmark baseline ([ADR-0009](docs/adr/0009-benchmark-baseline.md)).

## Measured results

Only numbers produced by `bench/` are published. Latest staging run (15 prompts, 3 per recipe):
[bench/results/2026-10-11-18-03-benchmark.md](bench/results/2026-10-11-18-03-benchmark.md). Baseline comparison:
[bench/baseline/](bench/baseline/).

## Public API

```bash
curl -X POST https://software.turbineh.com/v1/builds \
  -H "Authorization: Bearer $TURBINEH_API_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"A client portal where clients submit requests with attachments and follow their status"}'
# → { "build_id", "status_url", "events_url" }  ·  live trace: GET /v1/builds/{id}/events (SSE)
```

OpenAPI: [`/v1/openapi.json`](https://software.turbineh.com/v1/openapi.json) · docs: [`/docs`](https://software.turbineh.com/docs).

## Repository

```
apps/web               software.turbineh.com: prompt UI, live trace, results, catalog, docs, public API /v1
apps/worker            build queue worker: pipeline, finalize (verify → correct → remediate → report), delivery
packages/compiler      prompt → BuildSpec (decider batch + small open model parts)
packages/decider       Decider interface · JEV · open decider · fallback
packages/selector      one batched decider request per build; capability labels
packages/resolver      deterministic versions, licences, peers and conflicts
packages/assembler     recipes + deterministic entity code + native components + docs
packages/integrator    external components (install, contract tests, glue), Backup Coder gaps, corrector
packages/backup-coder  primary/secondary open coders, triggers T1–T6, catalog flywheel
packages/verifier      sandbox, verification, Semgrep rules, quick checks
packages/remediation   security fixes (dependencies + code), triage, improvement estimate
packages/reporter      user report (decider for criteria, open writer model for text)
packages/catalog       component.yaml schema, validator, approval gate
packages/curation      evaluate + certify components (contract tests + typecheck in the sandbox)
packages/db · storage · shared   Postgres access, artefact storage, config and logging
catalog/               recipes, component manifests, curation batches, gap records
ingest/                discovery layer: registry metadata + embeddings for catalog candidates
services/              sandbox image, open decider
infra/staging          Scaleway + Vercel provisioning (idempotent)
bench/                 prompts, runners and measured results (the only source of public numbers)
docs/                  plan, ADRs, runbooks
```

## Getting started

Requirements: Node 24+, pnpm 10, Docker, gitleaks (pre-commit hook).

```bash
pnpm install                    # also enables the gitleaks pre-commit hook
cp .env.example .env.local      # fill in; never commit
pnpm db:up && pnpm db:migrate   # local Postgres + pgvector (Docker)
pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm catalog:validate
pnpm build:local "<prompt>"     # full pipeline locally (Docker required)
pnpm bench                      # benchmark against staging
```

Smoke tests: `pnpm smoke:decider` · `pnpm smoke:compiler` · `pnpm smoke:backup-coder`. Staging runbook:
[docs/STAGING.md](docs/STAGING.md).

## Documentation

- [Product description (source of truth)](docs/PRODUCT_DESCRIPTION.md) · [Plan](docs/PLAN.md) · [Architecture](docs/ARCHITECTURE.md) · [Component manifest](docs/COMPONENT_MANIFEST.md)
- [Decider best practices](docs/DECIDER_BEST_PRACTICES.md) · [ADRs](docs/adr/) · [Staging](docs/STAGING.md) · [Secrets](docs/SECRETS.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## License

[Apache-2.0](LICENSE). Copyright 2026 Alex Ruiz (TurbineH). As sole copyright holder the owner keeps the right to use,
relicense or commercialise the code in any way.

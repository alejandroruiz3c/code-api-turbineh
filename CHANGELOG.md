# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- WP7: recipe inheritance (`recipe.yaml`: extends, provided entities, default capabilities, nav); recipes `internal-tool` (CSV import/export, search, pagination) and `landing-waitlist` (public waitlist with honeypot + rate limit + no enumeration, confirmation email, admin allow-list); search + pagination on every generated list; components data.csv-export/import, data.pagination, email.transactional (turbineh).

- WP7: recipe `saas-crud` template (Next.js 16.3.8, better-auth with organizations, Drizzle, Zod, Tailwind, Security Pack) with committed lockfile, unit tests and Playwright E2E.
- WP8: `@turbineh/resolver` (deterministic status/license/peer/conflict checks), `@turbineh/selector` (one batched decider request per build, atomic plain-language questions, T1/T2 triggers), `@turbineh/assembler` (recipe + deterministic entity code generation + docs).
- WP9: sandbox image and `@turbineh/verifier` (offline install/build/test, E2E on an internal network, gitleaks, OSV with production/development scope, license scan) — ADR-0011.
- WP6 (first batch): 7 approved components exercised by recipe `saas-crud`.
- `apps/worker`: `pnpm build:local "<prompt>"` runs compile → select → resolve → assemble → verify → local delivery with traces in Postgres (Gate G1).

- WP5: Postgres + pgvector (infra/docker-compose.yml, pinned by digest), `@turbineh/db` (SQL migrations, pool, open embeddings `qwen3-embedding-8b`@1024), `@turbineh/ingest` (ecosyste.ms npm metadata with on-disk cache and backoff; `pnpm ingest --pages N --embed`).

- `pnpm open-decider`: on-demand open decider via uv (no manual venv); cost/operation policy in ADR-0004.
- docs/PRODUCT_DESCRIPTION.md: transcription of the source-of-truth product description, with the later owner decisions mapped to ADRs.

- Compiler decomposed (ADR-0010): decider decides recipe + capabilities in one batched request; the small model writes four small bounded parts in parallel; code assembles and validates. Production compiler on Scaleway (`gemma-4-26b-a4b-it`, reasoning off). Backup Coder live on Scaleway (`deepseek-v4-flash-0731` + `glm-5.2`). Portable path regex for provider grammar engines.

- ADR-0009: benchmark baseline uses a closed frontier agent (measurement only); ADR-0008 budget accepted; Scaleway project `code-frontiers`.

- G0 decisions: Apache-2.0 LICENSE + NOTICE; deployment host software.turbineh.com (ADR-0005 accepted); repo in the owner's account (ADR-0007); quyet exception approved (ADR-0002); budget proposal and cost controls (ADR-0008).

- Workspace hygiene: repo renamed to `code-api-turbineh`; docs/SECRETS.md; ADR-0007 (GitHub organization); ADR-0003 updated with the proposed EU provider (Scaleway); workspace paths in CLAUDE.md.

- WP4: `@turbineh/compiler` (prompt → BuildSpec with JSON-schema constrained decoding, 2 retries with error feedback, T5 escalation) and `@turbineh/backup-coder` (open-weights primary/secondary with automatic failover, triggers T1–T6, generated-backup header, catalog/gaps records); smoke tests; ADR-0003.
- WP3: `@turbineh/catalog` — `turbineh.component/v0.1` JSON Schema, validator with deterministic approval gate, `pnpm catalog:validate`, 3 example manifests (zod, drizzle-orm, better-auth; status evaluated); docs/COMPONENT_MANIFEST.md.
- WP2: `@turbineh/decider` — Decider interface on the official TypeSafe SDK; JevDecider (pinned jev-1.13.0), OpenDecider (Quyet via `services/open-decider`), FallbackDecider, automatic two-level batched beam for Choices above backend limits, portable confidence, question builders; smoke test; ADR-0004; docs/DECIDER_BEST_PRACTICES.md.
- WP1: pnpm + turborepo monorepo, strict TypeScript, ESLint, Prettier, Vitest; CI (gitleaks on full history, format, lint, build, typecheck, test, manifests); GitHub templates; README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT; ADR-0001 (architecture), ADR-0002 (stack), ADR-0005 (user interaction, proposed), ADR-0006 (infrastructure for speed, proposed); `@turbineh/shared` (validated env, redacting logger).
- WP0: secrets hygiene — strict `.gitignore`, gitleaks config, pre-commit hook (`.githooks/pre-commit`) and `.env.example`.

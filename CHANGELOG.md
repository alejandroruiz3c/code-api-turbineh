# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Catalog batch 4: 40 new approved components (106 manifests) for websites, landing pages, management apps and e-commerce — content and SEO (front matter, RSS, Markdown, JSON-LD, sitemaps), website and app UI (carousel, accordion, tabs, menus, tooltips, popovers, select, navigation, react-aria, animation, drag and drop, virtual lists, OTP input, drawer, URL state), commerce and data (cart state, money, countries, search index, data fetching, ids, barcodes, XML, HTTP client, plain-text email) and object storage (S3, presigned URLs, Vercel Blob); 27 new capabilities; manifest categories content, seo, commerce, storage.

- "Deploy for me" (ADR-0017, optional): `@turbineh/deployer` deploys a verified build into the client's own Vercel account and a new Neon database (EU) or their existing Postgres — settings and secrets configured, migrations inside the client's build, live check — and returns an adapted package (`DEPLOYED.md`, `START_HERE.html` live mode). `POST/GET /v1/builds/{id}/deploy-app`, guided dialog with live progress; credentials erased when the job ends.

- Client brand (ADR-0016): optional main colour, typeface and logo when asking for an app ("Add your brand" in the prompt box, `brand` in `POST /v1/builds`), applied as theme tokens with WCAG-based text contrast; logo checked by content; repository made public after a full-history gitleaks scan and path clean-up.

- Baseline comparison (ADR-0009), representative and time-boxed: 4 recipes, same verification gate — ours 4/4 verified (avg 110 s), Claude Code + Opus 5.5 0/4 (all functional checks pass; LGPL `sharp`, unpatched production advisory, unannotated public actions), $5.88 total (`bench/results/2026-10-11-baseline-comparison.md`).
- `START_HERE.html` restyled after api.turbineh.com (logo, cream/panel cards, who/when per document).
- Semgrep: authorization rule also accepts session checks combined with other conditions; test setup files excluded from the child-process rule.

- Client handover: every package now includes `START_HERE.html` (one self-contained page in TurbineH style: status, the 3 steps to go live, what each document is for) and `DEPLOY.md` (go-live guide with only the settings that app uses, Vercel + Neon or own server, background jobs when present, first steps and upkeep).

- Curation: contract tests are also type-checked (strict, same settings as generated apps); 52/52 external components re-certified; evidence references are repo-relative.

- G2 fixes: native component `jobs.queue.turbineh` (Postgres queue with SKIP LOCKED claiming, typed jobs, exponential backoff, secret-protected runner endpoint), copied by the assembler only when selected — the most frequent Backup Coder gap is gone; manifests declare `integration.types` (exact `@types/*` for libraries without bundled types: papaparse, ms, validator, qrcode, he, sanitize-html), installed with the component. Plan updated to `software.turbineh.com`.

- WP16: benchmark runner (`pnpm bench`) and 15 prompts across the 5 recipes (`bench/prompts/`); first staging run in `bench/results/2026-10-11-15-52-benchmark.{json,md}`; baseline procedure documented (`bench/baseline/`, pending an API key, ADR-0009).

- WP15: recipes `bookings` (weekly availability, conflict-free booking under a per-workspace lock, 7-day calendar, email confirmation) and `client-portal` (requests with status workflow, file uploads type-checked by content and size-limited, attachment-only downloads with the same visibility rule); unit and E2E tests; verified through the pipeline (`bench/results/2026-10-11-d2-recipes.json`).

- WP10 (ADR-0015): `@turbineh/integrator` — approved external components are installed at exact versions with their contract tests running inside the app and a small generated helper; Backup Coder fills self-contained gaps (T1/T2) with module + tests and records them (catalog flywheel); corrector with directed patches, quick checks between patches, granular and full swap, Backup Coder takeover (T4); compiler fallback to the Backup Coder (T5).
- Staging fixes: template esbuild pin, range overrides in dependency remediation, closed next-step list, recipe-provided capabilities.

- ADR-0014 · security remediation before delivery: Semgrep static analysis with TurbineH rules; `@turbineh/remediation` (automatic dependency and code fixes, repair if a fix breaks a quality gate, full re-verification after every round, plain-language alerts); `@turbineh/reporter` (criteria mapped to evidence by the decider, texts by the open writer model, deterministic fallback); `POST /v1/builds/{id}/improve` and "Improve & redeliver" in the result view; report and security panels in the web UI.
- Remediation routing with one batched decider request per round and parallel fixes; "Improve & redeliver" shows the expected gain, duration and quota cost beforehand and can be requested once (the improved delivery is final).
- Faster verification without removing checks: per-lockfile base image, concurrent scans, parallel lint/typecheck/unit/build.

- ADR-0013: delivery scope = complete verified package + push to the user's own GitHub; TurbineH-hosted customer repositories (channel C) out of scope.

- Staging (ADR-0006): Scaleway fr-par — managed PostgreSQL 16 + pgvector with verified TLS (`DATABASE_CA_CERT`), private Object Storage bucket for artefacts, worker host (Docker sandbox, systemd, unprivileged user, firewall); Vercel project in cdg1 with `software.turbineh.com` (IONOS CNAME). Infrastructure as code in `infra/staging` (idempotent).

- WP14: `apps/web` (software.turbineh.com) — prompt-first home with GitHub sign-in and prompt resume, live build trace over SSE, result view (file tree, docs, zip, Push to my GitHub), catalog, API docs, TurbineH design system.
- WP13 (part 2): public API `/v1` in the web app (builds, events SSE with Last-Event-ID, components, deliver, OpenAPI 3.1, RFC 9457 errors, quotas, idempotency, cost cap); `pnpm catalog:sync`.
- WP12 (channel B): deliveries queue; the worker creates a private repo in the user's account and pushes the bundle with one git push; user tokens AES-256-GCM encrypted and erased after use; `repo` scope requested only when pushing.

- WP13 (part 1): Postgres build queue (idempotency keys, SKIP LOCKED claiming, stale requeue), hashed API keys with daily quotas, daily cost circuit breaker; worker service with channel-A artefacts (zip, git bundle, file list, docs) on local or S3 storage (`@turbineh/storage`).
- WP15 (Abuse Guard): atomic abuse questions in the same decider batch as the compiler; flagged prompts are rejected before assembly.

- WP6: `@turbineh/curation` (`pnpm catalog:curate`): evaluate (registry + OSV) and certify with contract tests in the sandbox; batches 2–3 → 63 approved components covering ~50 capabilities; licence gate rejects `busboy` (no licence) and `nodemailer` (MIT-0) — ADR-0012.
- Capabilities expanded to 54 (atomic decider question + plain-language label each); capability threshold 0.6; native-first selection policy; external selections reported as integration pending.

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

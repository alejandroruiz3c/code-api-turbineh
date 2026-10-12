# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Curated glue for `ops.retry.p-retry` (bounded retries with jitter, AbortError for non-retryable errors) and `files.type-detection.file-type` (content sniffing limited to the first bytes, upload allow-list check); re-certified.
- F3 catalog batch (`catalog/curation/batch-6-ai*.yaml`): 22 approved utilities for AI agents and inference processes, each with a contract test and curated glue (bounded inputs, safe defaults), certified in the sandbox. None calls a model (model calls go through the orchestrator, component #001). Documents: `files.pdf-text.unpdf`, `files.docx-text.mammoth`, `files.office-text.officeparser`, `email.parsing.mailparser`; web content: `content.html-dom.linkedom`, `content.readability.mozilla-readability`, `content.html-parse.cheerio`, `content.html-to-markdown.node-html-markdown`, `content.markdown-to-text.remove-markdown`; model I/O: `ai.json-repair.jsonrepair`, `ai.partial-json.partial-json`, `ai.sse-parsing.eventsource-parser`, `ai.schema-validation.ajv`, `ai.prompt-templates.mustache`, `ai.token-count.gpt-tokenizer`; retrieval: `ai.text-chunking.sentence-splitter`, `ai.vector-store.pgvector`, `ai.language-detection.franc-min`, `ai.stopwords.stopword`; agents and batches: `ai.mcp-server.modelcontextprotocol-sdk`, `ops.queue-throttle.p-queue`, `data.yaml.yaml`. 22 new capabilities with one decider question each. 146 components in total.
- Internal operations panel `/ops` and `GET /v1/ops` (staff only via `OPS_ADMIN_EMAILS`/`OPS_OWNER_IDS`, 404 for everyone else): builds per minute, green rate, average time, queue, live workers, per-worker stats, recent failures, cost today/cap and average cost per build.
- Curated glue for `data.countries.i18n-iso-countries` (validation, localised names, select options in en/es); re-certified.
- Storefront currencies from the request: the assembler reads the currencies the spec names (deterministic, no model; first = base) into `SHOP_CURRENCY`/`SHOP_CURRENCIES`, and Deploy for me carries the `SHOP_*` settings to the client's Vercel project.
- Graceful worker stop: on SIGTERM the worker claims nothing new and finishes running builds, deliveries and deployments (units allow 30 min; `deploy.sh` installs the unit files from the repo). Deploys no longer interrupt builds.
- AWS worker schedule 09:00–21:00 Pacific Time (ADR-0024): self power-off timer on the instance, start timer on the Scaleway host with a start-only IAM key.
- `infra/aws/worker.ts allow-ssh`: replaces the operator SSH rule with the current IP (the operator's IP changes; SSH is never opened to everyone).
- T3 business rules on edits and across entities (ADR-0026): every generated entity gets an edit page and `update` action (role-checked, workspace-scoped, E2E-tested); rules receive the operation, the previous record and read-only, code-written loaders of related entities linked by reference fields; the decider decides create/update/both and the related entity; the report shows when each rule runs and what it reads.
- `pnpm load`: load test that submits one prompt per recipe at once and records wall clock, throughput, green rate and queue depth (`bench/results/*-load.json`).
- Curated glue for `ops.http-client.ky` (HTTPS only, 10 s timeout, retries only for GET/HEAD, zod-validated JSON) and `files.image-processing.jimp` (bounded input and dimensions, re-encoded thumbnails without EXIF): their model-written glue kept spending corrections. Re-certified in the sandbox.
- Viral capacity (ADR-0027): per-IP daily build quota for browser sessions (`IP_DAILY_BUILDS`, IP stored only as an HMAC) and a selection cache (same normalized spec + same catalog candidates → no decider call; 7-day validity).
- AWS worker management (ADR-0024): `infra/aws/worker.ts create|status|stop|start|terminate` (IMDSv2, encrypted disk, SSH from the operator IP only, fixed IP).
- Storefront (ADR-0025): optional automatic Stripe Tax (`SHOP_TAX_MODE=stripe`; tax and total recorded from the signed payment event), discount codes (percent or fixed amount, minimum order, usage limit counted atomically on payment, last valid day, rate-limited attempts) and several currencies with explicit prices per currency (`SHOP_CURRENCIES`, no exchange rates; shipping per currency; JSON-LD offer per option and currency). Benchmark prompt `shop-05`.
- Curated glue: a component may ship `glue.ts` (written by TurbineH, type-checked at certification) that is copied into apps instead of model-written glue. First one: `email.plain-text.html-to-text`, whose generated glue used options removed in html-to-text 9+ and failed the build in every app that selected it (3 wasted corrections, then dropped).
- AWS extra worker groundwork (ADR-0024): `infra/aws/worker.ts check` (identity and instance types, read-only).
- "Connect Vercel" active in production (integration `turbine-deploy`).

- Separate staging and production (ADR-0022): `staging.software.turbineh.com` with its own Vercel project, database, artefact bucket, worker and secrets; `infra/staging/deploy.sh <staging|production>` (production only from a clean `main`).
- "Deploy for me" with "Connect Vercel" (ADR-0021): the client authorises the TurbineH integration instead of pasting a token; token encrypted, single use, 30-minute expiry; pasted tokens remain as fallback. Activates when the integration credentials are configured.
- Screen previews skip the sign-in page: internal tools show the dashboard and two modules instead.

- Storefront recipe (ADR-0020): product options (size, colour…) with own SKU, price override and stock; shipping options by country with free-from amounts; tax rates by country with tax-inclusive or tax-exclusive prices (`SHOP_PRICES_INCLUDE_TAX`), integer-cent rounding documented and unit-tested; breakdown in cart, Stripe Checkout, admin orders and emails; one JSON-LD offer per option. The recipe now ships its own `.env.example` (admin emails, Stripe keys, currency, tax mode), so handover guides and Deploy for me list every setting the shop uses.
- Backup Coder trigger T3 (ADR-0023): business rules from the request (limits, uniqueness, no overlaps, value ranges) on generated entities are selected by the decider with fixed thresholds, written by the Backup Coder as a server-side rules module with its own tests, checked on create and CSV import, and guarded by a code-written fixture test. Rules that cannot be made green are removed before delivery and reported as not implemented. The report lists every rule with its tests; the benchmark counts them.
- API keys in the UI (`/keys`): create (shown once), list and revoke; `GET/POST /v1/keys`, `DELETE /v1/keys/{id}` (max 5 active keys per account).
- Real cost per build: measured tokens × Scaleway list prices per model plus a fixed overhead (`COST_OVERHEAD_EUR_PER_BUILD`), stored in the build metrics and the daily cost ledger.
- Screen previews: after E2E the sandbox captures home, dashboard and the first module; shown in the build result and in the API (`artifact.previews`).
- Weekly catalog watch (`pnpm catalog:watch`, GitHub Actions): re-checks every approved component against OSV and opens or updates an issue when an advisory appears.
- Worker heartbeat: `/health` reports workers alive in the last 90 s, running builds and queue length.

### Fixed

- Dependency licence check follows SPDX expressions: "A OR B" blocks only when every option is copyleft (jszip "MIT OR GPL-3.0-or-later", pulled by mammoth, is used under MIT); "A AND B" blocks when any part is. It was a substring match on "GPL".
- Build cost is internal: `GET /v1/builds/{id}` no longer returns `metrics.cost` to clients (staff and internal keys still see it).
- Worker hosts filled their disk with sandbox base images (64 GB on the Scaleway host), making every build fail at `install`. Daily `turbineh-maintenance.timer` keeps the 8 newest base images, prunes build cache and anonymous volumes and removes build dirs older than 3 days; workers stop claiming builds below 15 GB free (`MIN_FREE_DISK_GB`).
- Graceful stop: sandbox processes run in their own process group and units use `KillMode=mixed`, so a stop never reaches a verification in progress.
- A Semgrep run killed under load (empty or truncated JSON) crashed the whole worker process and stranded the other builds running in it. The scan is retried once and otherwise fails the `static` step (a scan that did not run never counts as clean); the scans promise is handled early and the worker logs unhandled rejections instead of exiting.
- `deploy.sh` builds the sandbox image on hosts that do not have it: the new AWS worker failed every build at `install` during the load test (stopped within minutes; Scaleway kept serving).
- Generated entities that would collide with a table defined by the recipe or a native component (e.g. a "Subscription" entity next to `payments.subscriptions`) are no longer generated: the build failed to compile (benchmark `saas-04`).
- `pnpm bench` survives network drops on the operator's machine (retries with backoff) and can resume a run with `BENCH_RUN` (finished builds are reused through their idempotency keys).
- Correction commits no longer include migrations generated during verification: those go in their own `chore(db)` commit first.
- T3 rules: "after/before/more than/less than" are strict and "from/until/at least/at most" inclusive; rule tests include the boundary case.
- `pnpm bench` targets staging by default with the staging smoke key (ADR-0022); production only with `BENCH_API_URL`.
- T3 skips rules that need other kinds of records (another entity, users, members): one more atomic decider question plus a deterministic check for other entity names in the rule text, so they no longer spend correction attempts before being dropped.
- Entity plurals: words already plural or uncountable (`Stats`, `Settings`, `Data`) are no longer pluralized again; `-is` → `-es`.

- Native component `payments.subscriptions.turbineh` (ADR-0019): Stripe Billing subscriptions per workspace (hosted Checkout, Customer Portal, signed webhook, `requirePlan`), verified against stripe-mock; native components can add menu entries. 31 benchmark prompts across 10 recipes.

- Recipes from the use-case research (top 5 of AI-built software): `projects` (kanban boards, tasks with assignees, priorities, due dates, comments, my tasks), `analytics-dashboard` (CSV import validated per row, KPIs with previous-period comparison, accessible native SVG charts, filters, CSV export), `tracker` (habits and daily amounts, goals, streaks, 30-day history). Ten recipes in total.

- Payments verified in every shop build: the verification starts Stripe's official API simulator (stripe-mock, pinned digest) on the isolated network; the E2E creates a real Checkout Session against it, sends signed webhooks (twice, idempotency) and checks order paid, stock decremented and cart emptied. `STRIPE_API_BASE` (defaults to the real API); webhook also matches the order by `client_reference_id`.

- Pre-commit secret barrier for model-written code: glue, Backup Coder modules and tests, corrector patches and security fixes are scanned with gitleaks before they enter git history; leaking parts are removed or reverted (found by the final benchmark: a generated test with a key-like literal). Code rules forbid key-like literals in tests.

- Catalog batch 5: 17 more approved components (123 manifests): maps (MapLibre), image processing (Jimp), cookie consent, image lightbox, PDF from React, QR codes as components, file drop zones, colour picker and the remaining accessible controls (slider, checkbox, switch, progress, avatar, scroll area, toggle group, confirmation dialog, hover card); 14 new capabilities.

- Recipe `storefront` (ADR-0018): catalog with images and search, cookie cart, Stripe Checkout via REST (hosted page), signed idempotent webhook with stock in one transaction, orders and products admin, Product JSON-LD.
- GEO by default in public recipes: `/llms.txt`, Organization/WebSite/FAQPage/Article/Product JSON-LD, robots.txt open to AI crawlers on public pages (single opt-out switch), sitemaps.
- Benchmark prompts for corporate sites and shops (21 prompts).

- Recipe `corporate-site`: home, services, about, blog (safe Markdown renderer, RSS), contact form (rate limit, honeypot, email to admins), admin panel to edit website texts, posts and messages, SEO (metadata, Open Graph, JSON-LD Organization/Article, sitemap with posts, robots).

- Landing recipe extended: benefits, how it works, FAQ, final call to action, SEO (metadata, Open Graph, JSON-LD, sitemap.xml, robots.txt) with copy written for each business (new optional `site` part of the BuildSpec, deterministic fallback; only awaited for public-site recipes).

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

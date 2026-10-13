# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Domain components, part 2 (ADR-0045): `storage.private-uploads.turbineh` (limits and types from params, local disk
  or S3-compatible storage with SigV4 and an offline mock, per-scope authorised downloads, staff email on client
  uploads), the bookings recipe on `domain.bookings.turbineh` (public `/book` page, cancel link with the notice policy,
  staff day/week calendar per team member, time off, staff move/cancel with customer emails; the recipe's own booking
  code removed) and `jobs.scheduled.turbineh` (cron route protected by `CRON_SECRET`, idempotent runs, overdue and
  daily email digests). New seams: `src/server/body-limit.ts`, `src/workflow/extras.tsx`, `src/workflow/board.tsx`.
  Checked combinations: Ledgerline, Sala Nueve, Pixelyard.
- Spec fidelity wired into builds (ADR-0044): the pipeline models every request (decider only for unsure entity
  kinds) and the assembler generates by kind — business CRUD (status as a `domain.workflow` item when selected),
  configuration as a settings page, events as an append-only timeline on the parent (database trigger), child lists
  and joins as a section of the parent page, logs as a table and writer without UI, memberships and tags with no page.
  Generated `src/server/permissions.ts` (role matrix, per-resource rules, sign-up email domains) behind `can(role,
action, resource?)`, `src/lib/spec-constraints.ts` (time zone, currency, limits, statuses, sort, page size), unit
  tests per app (`tests/unit/permissions.test.ts`, `spec-constraints.test.ts`) and a sign-up-domain E2E. Domain
  patterns select approved catalog components by capability with params validated against their
  `params.schema.json` (new components are picked up automatically); missing ones are listed in AGENTS.md with where
  and how. List filters are shared with a CSV export that honours them and the `export` permission.
- `verify:spec <fixture>`: offline build of a learning-round spec (no model), before/after summary and the gate.
- E2E proofs act as the workspace owner under the request's label (Staff, Manager…); the base `authz.test.ts`
  checks the role matrix generically (ADR-0044).
- `turbineh verify --full` (ADR-0043, learning round G4c): the gate's security and policy checks locally with the
  gate's pinned versions — gitleaks 8.30.1 (git history and the files the next commit adds, redacted), the TurbineH
  Semgrep rules on Semgrep 1.178.0 (embedded in the CLI), OSV (package name@version only) and the licence policy — plus
  typecheck, lint and unit tests. Docker first, pinned local binaries otherwise; a check that cannot run is reported as
  not run and fails. Each finding has file:line, the rule, a security / policy / quality label and the fix; `--json`
  uses the gate findings' shape (which now carry `fix` too). The default `turbineh verify` flags secret-shaped literals
  in `src/env.ts`. AGENTS.md "Before handing over", the agent instructions, the MCP `verify` tool (`full`) and /use
  name it.
- Spec fidelity in the compiler (ADR-0042): entity kinds (business, relationship, event, configuration, log) by code with decider fallback only for unsure entities, roles and permission rules from the request mapped onto workspace roles, constraints (time zone, uploads, notice, hours, prices, statuses, sort, schedules, email domains) and domain-pattern detection with catalog-gated component selection. Regression tests over the 9 learning-round specs; offline summary in `bench/frontiers/fidelity-2026-10-13.md`. The generator supports `tags` fields with a tag filter and enum options from stated status lists.

### Security

- Criteria honesty (ADR-0043, learning round G3): hand-written `acceptance.yaml` rules now carry the shipped test's
  title and key assertions and match only when `proofVerdict` accepts them and the test exists in the package (re-checked
  at verification). The bookings test "the owner books a slot and sees it in the calendar" no longer proves seven
  unrelated criteria. 71 labelled pairs from hand-written rules: precision 1.00, recall 0.48 (109 pairs overall:
  precision 1.00, recall 0.63).

- Public and pre-membership server actions (ADR-0040): the base template ships `publicAction(name, { rateLimit,
schema }, handler)` (per-IP rate limit + Zod before anything runs) and `requireSession()` (signed in, not a member
  yet). `turbineh.server-action-without-authz` accepts both, now also checks async function-expression exports and
  rejects `publicAction` without its rate limit or schema; the waitlist and contact templates use it instead of
  `nosemgrep`. `src/env.ts` generates build-only values at runtime instead of secret-shaped placeholders; AGENTS.md
  documents both patterns.
- GitHub connections only in private workspaces: with the shared invitation token the workspace comes from a header (or the shared `api-default`), so connecting, using or opening pull requests with GitHub requires a random workspace id (what the browser and `turbineh init` create); guessable names get an actionable 403 and stored credentials are never used for them.
- Booking assistant: "find my bookings by email" emails the list (with references) to that address instead of showing it in the chat; the reply is the same whether or not bookings exist, with a 10-minute cooldown per address (no disclosure of someone else's appointments, no inbox flooding).

### Changed

- Business model (owner decision, 2026-10-13, `docs/PLAN.md` §16.7): the library is free and open; the $5 per
  delivery and "first flow free" pricing is withdrawn. The product area's tagline is now "Secured software flows. In
  seconds. Free and open."

### Added

- Agent brain comparison (`bench/agent-brain/`): the shipped runAgent through the production AI gateway against
  Claude Opus 5.5 called directly without orchestrator, on the same 54 Flex Physio conversations, tools and
  deterministic checks, run twice each. Ours 54/54 and 54/54 (Claude 51/54 with 3 network errors, then 54/54);
  turn p50 3.30–3.51 s vs 4.18–4.28 s, p95 7.73–7.86 s vs 8.12–9.62 s; 2.07–2.11 vs 11.61–19.40 USD per 1,000
  conversations. Results and the dedicated-vs-serverless decision note in `bench/agent-brain/RESULTS.md`.

- Domain components for common business patterns (ADR-0041): `domain.workflow.turbineh` (states, role-gated
  transitions, immutable history, stuck/overdue alerts), `domain.membership-access.turbineh` (roles from the request,
  invitations by email with a role, accept flow with `requireSession()`, per-record scopes) and
  `domain.audit-log.turbineh` (append-only audit log, owner page with filters and CSV export). Parameters declared with
  a JSON Schema (`params` in component.yaml, checked by `catalog:validate`); base seams `src/server/role-policy.ts`,
  `src/server/record-access.ts`, `src/lib/audit.ts` (generated entities record their changes); `src/db/sql/*.sql`
  applied by `db:migrate`; assembler adapters `files-recipe/` and `files-with/`; `verify:recipe` component
  combinations with request params.
- Which app of a monorepo receives a capability is decided by the decider when the repository has several Next.js
  apps (ADR-0039 Amendment 1, owner decision): plans, the repository analysis and the worker's integration use
  `chooseAppPath`; the path heuristic stays as the fallback (one app, low confidence, no decider, errors, the CLI).
  Database and auth strategy stay in code. On the 20 labelled repositories: app 20/20 (was 17/20), database 20/20
  (18/20), auth 20/20 (17/20); the decider is asked for 4 of 20 repositories, 107 ms each on average.

- Decisions through the decider (ADR-0039): audit of every model call (`docs/decisions-audit.md`) and the rule —
  decisions among options → the decider, generation → open models, deterministic questions → code. **runAgent**
  (component `ai.orchestrator.turbineh` 0.3.0) takes each turn's first action — which tool, or a reply — from the
  decider in the request it already made (route + safety), and the open model writes only that tool's arguments or the
  reply; below the confidence threshold, after a tool result or without a decider the model chooses among every tool
  as before. A decider call at every step was measured slower and costlier and is not used. Measured on staging
  (`bench/agent-decisions/`): same accuracy, −13 % model input tokens, −1.2 % cost per conversation, −17 % cost on
  single-action turns. The GitHub integration's adaptation decisions stay in code (measured: database and auth are
  fixed policy and compatibility; the decider is more accurate on monorepo app choice but slower and costlier — owner
  decision). `verify:recipe` assembles the domain components a prompt names (e.g. bookings).
- **How to use** page, `/use` (ADR-0038): one public page for the three ways in — people on the web (invitation,
  describe → plan → generate → verified result → integrate as ZIP or pull request, what each package contains, the
  states), coding agents (install, `turbineh init`, `turbineh build @spec.md --json` with events, exit codes, timeout
  and resume, `left`/`verify`, `apply --pr`, MCP for Claude Code, Codex, Cursor and any client, rules for agents) and
  the API (Bearer token, why the workspace id must be a random UUID, main endpoints, catalogue index); use cases come
  from the catalogue recipes. `/cli` and `/docs` redirect to its sections; the navigation shows "How to use". Tests
  render the page and check every CLI command and flag shown against `turbineh --help`.

- Native fit in the coding agent's flow (ADR-0036, Frontiers R1): **`turbineh build "<spec>" | @spec.md`** — plan →
  generate → wait → write → commit → summary in one command. Empty folder: the complete verified app (agent files
  merged, `.gitignore` unioned, nothing of yours overwritten); existing project: the capability adapted locally with
  the GitHub integration's rules, on a new branch when you are on the default one. One commit, with a fallback
  identity when none is configured. Summary (human and `--json`): files, gate, criteria met/open with where, `left[]`,
  settings, next command. `--json` streams `started` and `plan_ready` (components and criteria no shipped test will
  prove) before the result. Meaningful exit codes (0 green, 3 decision, 4 timeout, 5 failed, 6 gate not green,
  7 local conflict), `--timeout`, `turbineh resume [id]`. **`turbineh init --agent claude|codex|cursor`** writes a
  short, idempotent block into `CLAUDE.md`/`AGENTS.md` and, for Claude Code, the skill
  `.claude/skills/turbineh/SKILL.md` (full CLI path when it is not on PATH). **`turbineh mcp`**: MCP server on stdio
  (build, resume, search, plan, apply, status, left, verify) whose results are the `--json` documents —
  `claude mcp add turbineh -- turbineh mcp`. **Less waiting**: plans asked to continue go straight into generation
  server-side (parts TurbineH writes itself no longer stop the build), the CLI checks every 1–2 s, and model-written
  glue that passed the gate is reused by later builds (verified-glue cache). **Full specs**: up to 20,000 characters
  and up to 15 compiled criteria, each returned as covered/open in the plan (`criteria`) and met/open in the summary.
  `GET /v1/plans/{id}/package?format=app`; `install.sh` points the CLI at the server it came from.
- Robust builds (ADR-0037, from the Frontiers booking-agent rerun 7362be2a / 66af3182, which delivered nothing after a
  single cross-component E2E failure):
  - **Never deliver nothing.** When only quality checks fail after corrections, the package is still delivered
    (ZIP, bundle, docs), marked `verified: false`. AGENTS.md, `turbineh.json` and TURBINEH_REPORT.md give the failing
    step, test, file:line, owner and a suggested fix. The API (`verified`, `delivery`, `error`), the UI and the CLI show
    "Delivered, not verified: N/M checks passed". The build status stays `failed` and the flow state is `generated`,
    never `verified`, so deploy, improve and pull requests still require a passed gate. If a security or policy check
    blocks (secrets, static security errors, blocking advisories, licences, or a scan that did not report), only the
    report is delivered.
  - **Corrections never remove unrelated components.** Every package records file ownership in
    `.turbineh/owners.json`. A failure is attributed to the owner of the failing test file and of its imports, and only
    implicated parts (glue, Backup Coder fill, business rules, integrated library) can be removed. There is no more
    full swap. The attribution is recorded in `metrics.attribution`.
  - **Non-functional requirements are not entities.** Rate limits, input limits, prompt-injection and abuse
    protection, timeouts, logging and similar requirements map to capabilities (Security Pack, AI Safety Pack,
    retries, logging) through the compiler prompt and a deterministic guard. They are never CRUD entities, so there is
    no `RateLimitTracker` with pages and E2E.
  - **Cross-component regressions are caught before main.** `verify:recipe` assembles recipes the way the pipeline
    does: required, domain and native components. `--list` and `--all` cover every combination. CI runs typecheck and
    unit tests of every recipe + domain-component combination on each PR that touches the catalogue or the assembler.
  - The gate output now keeps each failing step's key lines, and licence results always survive the output tail.
  - Test-only forced failure (`TURBINEH_TEST_FLAGS=1` on the worker plus a prompt marker). `deploy.sh` refuses a
    production worker that sets it.
- Zero-friction packages (ADR-0035, from the Frontiers shop rerun R2–R5), for every recipe and enforced by
  `catalog:validate`: **zero-setup local database** — `pnpm db:local`, and `db:migrate`, `dev` and `test:e2e` use a
  local PostgreSQL when `DATABASE_URL` is unset (real PostgreSQL 17 binaries via `embedded-postgres`, PGlite with
  pgvector for `ai-agents`, root or unsupported platforms), one line says so, E2E gets a fresh database and builds when
  needed — no PostgreSQL, Docker or sudo; **build and unit tests with only the required env** — allow-lists such as
  `ADMIN_EMAILS` are optional and deny by default, and the gate builds and tests with only what `src/env.ts` requires;
  **E2E owns its URLs** — `playwright.config.ts` sets `BETTER_AUTH_URL`/`APP_URL`/port itself (free port), and the
  gate runs with an ambient `BETTER_AUTH_URL` to prove it; **criteria proven by shipped tests** — every recipe ships
  `acceptance.yaml`, generated entities add their own rules, a criterion is met only with an existing test and a passed
  gate (never from non-test evidence), open ones say which files and which spec, and `ACCEPTANCE.md`, `AGENTS.md`,
  `turbineh.json` and the report agree. Storefront shows stock on product pages, with an E2E proving that an admin
  stock change reaches the catalogue. New checks: `local-db-missing`, `required-allow-list`,
  `required-env-undocumented`, `e2e-ambient-url`, `acceptance-missing`, `acceptance-test-missing`.
  `verify:recipe --local-db` / `--assemble-only`.
- Component documentation standard for the whole catalogue (ADR-0032 §Documentation): every component has a
  `guide.yaml` (turbineh.guide/v0.1) — what it does, use cases, when to use it and not, trade-offs, configuration,
  interfaces with real signatures, extension points, compatibility, security, guarantees linked to tests, limits,
  example, keywords and synonyms. The intake documentation step (`pnpm catalog:document`, run by `catalog:curate`)
  writes missing guides from the code with our open model and checks every claim against the code; all components
  backfilled. Used by `turbineh search` / `/v1/capabilities`, the agent-readable index (`/catalog/index.json`,
  `/catalog/llms.txt`, `pnpm catalog:index`) and apps; decider card modes measured with `bench:selection`.
- Agent runtime and domain components (ADR-0033; Frontiers Capability B, items A1–A6): **`runAgent()`** in `ai.orchestrator.turbineh` 0.2.0 — tool-calling loop with Zod-typed tools, irreversible tools executed only after the person's explicit confirmation (`prepare` → summary → yes/Confirm), step limit and timeouts, structured result and server-side conversation state, with the AI Safety Pack, routing, usage and audit; model endpoint = TurbineH gateway or any OpenAI-compatible endpoint from `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`. Public assistant (`POST /api/assistant`, `/assistant`, home widget) for public toolkits with per-IP rate limit, message size and turn limits. **`domain.bookings.turbineh`** (new category `domain`): team/rooms, services with duration and price, hours per weekday in an IANA time zone (DST-correct), availability from real data, create/move/cancel with notice policy, find by email, database-level double-booking guard, confirmation emails recorded, staff pages behind `ADMIN_EMAILS` (deny by default, `isAdminEmail`/`currentAdmin`/`requireAdmin` in `src/server/authz.ts`), toolkit of six tools. Domains are detected and parameterised from the request by code (`detectDomains`), selected by code, with defaults listed in the README. **`tests/mock-llm`**: scripted OpenAI-compatible model (tool calls, embeddings, decisions) started by Playwright in every AI app; offline booking E2E (book → confirm → email recorded, reschedule, invented time refused, cancel inside 24 h refused, staff allow-list, injection/size). **Acceptance criteria → tests** (`acceptance.yaml`, `ACCEPTANCE.md`, `.turbineh/acceptance.json`, met/covered/open after the gate). **Component guides** (`guide.yaml`, `turbineh.guide/v0.1`): use when/avoid when, trade-offs, config, interfaces, extension points, security, guarantees checked against shipped tests by `catalog:validate`, examples and keywords; rendered into apps as `docs/components/*.md` and added to decider cards. `turbineh.ai-direct-model-call` now catches hand-written ``fetch(`${BASE}/chat/completions`)`` clients and remediation reroutes tool loops to `runAgent()`.
- Agent-ready packages and catalogue standard (ADR-0032, from the Frontiers runs): every package ships `AGENTS.md`
  (+ `CLAUDE.md`) and `turbineh.json` — file map, extension points, theme tokens, env, acceptance criteria met (with
  the proving test) or open (with where to implement), verified gate results and the cheapest re-run per change;
  `turbineh left` and package-mode `turbineh verify` (file:line + fix). The palette stated in the prompt (background,
  accents, call-to-action, type) becomes theme tokens with WCAG contrast in every recipe; templates use tokens only.
  Storefront: https image URLs (CSP opt-in), search over descriptions, staff-only sign-up (shared `ADMIN_EMAILS`
  allowlist, deny by default; also landing and corporate site), offline paid-path E2E with a shipped Stripe mock.
  Shipped mocks for the subscriptions component (Stripe) and the orchestrator (AI gateway); `playwright.config.ts`
  starts every `tests/e2e/mocks/<ENV>.mjs` and generates test secrets at runtime. `pnpm catalog:validate` enforces the
  standard (257 issues on `main`, all fixed). `verify:recipe` runs the gate on a template locally.

- Connect GitHub and integrate into the client's existing repository (PLAN §16 P5, ADR-0034). **Connect GitHub** per access workspace (dedicated OAuth flow: state in an httpOnly cookie + hash on the server, PKCE S256, workspace binding, `public_repo` unless private repositories are chosen, token AES-256-GCM at rest, Disconnect revokes the grant); CLI `turbineh connect github [--private] [--with-token]`, `turbineh disconnect github`, `turbineh apply <plan> --pr [--repo] [--base]`. **Repository analysis** through the API without cloning (`GET /v1/repos/{owner}/{name}/analysis`, `plan.repository`): app folder in monorepos, router, `src/` layout, aliases, ORM and client module, auth, tests, CI, env file names only. **Adaptation** to the project's conventions and a **pull request** with one commit per step on `turbineh/<capability>` (lockfile and migration generated by the project's own tools in the sandbox), then **verification inside the project** (install, typecheck, lint, tests, capability tests, migration, build, only-planned-files, secrets) → ready for review and `integration_verified` only when everything passes, otherwise a draft with exact failures and next steps. PR body states exactly what the reviewer configures (required settings vs optional defaults, migration command). Glue that needs a model uses GLM-5.2 first. UI: Connect GitHub → repository search with private/public badges → analysis → plan → generate → PR with live state; Activity shows pull requests. Catalog documents both platform services (`deploy.github-pull-request.turbineh`, `ops.repo-analysis.turbineh`) for agents and the decider. Verified end to end on a real private test repository (`apps/worker/src/repo-integration.e2e.test.ts`).
- Product engine, API and CLI (PLAN §16, P2/P3/P5/P8, ADR-0031): `@turbineh/engine` (stack detection, compatibility, dependency diff, plans, states and results, capability package `turbineh.capability/v1` as a ZIP). API: `GET /v1/capabilities[/{id}]`, `POST /v1/plans` (plan only, nothing generated), `GET /v1/plans/{id}`, `POST /v1/plans/{id}/generate`, events, package download, integrations, `POST /v1/plans/{id}/pull-request` (repository integration as a pull request, never merged), `GET /v1/repos`, `GET /v1/activity`; errors are always an actionable ProductError. The `turbineh` CLI (`init`, `search`, `inspect`, `plan`, `apply`, `verify`, `revert`, `status`, `login`; `--json` everywhere) installed with `curl -fsSL https://software.turbineh.com/install.sh | sh`. The client orchestrator calls the TurbineH gateway with plain `fetch` (no decider SDK in client apps) and delivered reports carry no decider names. `/v1/components` now needs a token.
- Product UI (PLAN §16, P4/P8): software.turbineh.com is only the product area — Home (search by need, the three orchestration steps, workspace figures), Discover (complete flows and verified components with what they bring, requirements and a runnable example), New flow (need → environment: repository, uploaded manifests or stack, with "adaptation pending" when only a stack is given → plan review with decisions, files, dependencies, configuration, estimate and approvals → generate & verify), Flow (live decisions and checks, then precise states, what works and what needs configuration first, Try / Review / Check / Continue / Revert, Download ZIP, Integrate into repository, Copy instructions for your AI agent), Activity & reports (measured figures only, no cost), CLI and API pages. Typed client of the engine contract with graceful fallback to today's build endpoints. No sign-in chrome and no third-party decider names in the UI. Screenshots in `bench/results/ui-2026-10-13/`.
- Invitation access (ADR-0030): software.turbineh.com opens only with the access token (signed workspace cookie, no login); the same token works as the API key with an optional `x-turbineh-workspace` header. GitHub becomes optional.
- Direct model calls are rerouted through the orchestrator instead of blocking delivery (owner decision, ADR-0029 amendment): the AI rules are warnings, remediation always rewrites the call to `orchestrate()`/`embed()` (or disables it when the app has no orchestrator).
- TurbineH AI gateway (ADR-0029): client AI apps call `/v1/ai/v1/*` with a per-app token and use TurbineH's JEV and model keys, which never leave our servers; model allow-list, request limits, per-app rate limit and daily token quota, usage recorded per app (billing, future client usage metric). Tokens from the build page or set automatically by Deploy for me; AI usage per app in the ops panel.
- F3 core (ADR-0028; owner decision: F3 before F2): **component #001 `ai.orchestrator.turbineh`** (small open model plans → JEV decides route/acceptability/tool → open model answers; structured output, embeddings, usage per workspace) and **`security.ai-safety.turbineh`** (injection refusal, documents as data, limits and allowances, secret scan, tool confirmation, audit without content), always together. New recipe **`ai-agents`**: assistants with tools, knowledge base with cited answers (pgvector), batch classify/extract/summarise processes, usage and AI audit pages. Recipes can declare `requiredComponents` (selected by code). Semgrep rules `turbineh.ai-direct-model-call` / `turbineh.ai-sdk-dependency` fail any build that calls a model outside the orchestrator. `services/ai-mock`: deterministic model + decider simulator for sandbox E2E. Bench prompts `ai-01`…`ai-04`.
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

- Web: links that leave the product (landing waitlist, pull requests, live deployments, Vercel and Neon token pages, ZIP downloads) open in a new tab with `rel="noopener noreferrer"`; internal navigation and the GitHub/Vercel connect flows stay in the same tab. `src/external-links.test.ts` fails on any new external `<a>` without it.
- Acceptance criteria are "met" only when a test exercises them (ADR-0039 §4): generated CRUD tests no longer prove
  refusals, other roles or features they do not touch (production build `f195341c` showed "a viewer cannot edit a
  note", "invite a teammate", "audit log" and "search / tag filter" as met by create/edit tests); the report's mapping
  checks the test's steps and assertions and accepts the decider's match only at confidence ≥ 0.8. Labelled set of 38
  pairs: precision 1.00, recall 0.95.
- TurbineH AI gateway: `tools`, `tool_choice` and tool-call turns are forwarded (validated and bounded). They were
  dropped, so runAgent never called a tool through the gateway (6/20 correct first actions on staging before the fix).
- Agent instructions (AGENTS.md block, Claude Code skill, /use): run `turbineh build` in the foreground with a long timeout instead of in the background — in the Frontiers shop rerun the agent polled with blind sleeps and waited ~130 s after the result was ready.
- `/catalog/index.json` and `/catalog/llms.txt` accept the invitation token as `Authorization: Bearer` (ADR-0038);
  API callers without it get a 401 problem instead of a redirect to the access page.

- `turbineh init` without `--agent` writes the agent-neutral `AGENTS.md` (read by Codex, Cursor and most coding agents) unless the project already has `CLAUDE.md`; `--agent claude` still writes `CLAUDE.md` and the skill.
- Web deploys: agent worktrees (`.claude/`) are excluded from the Vercel upload (it exceeded 15,000 files and the production web silently stayed on an old build), and `deploy.sh` now stops with Vercel's error instead of filtering it out (text or JSON CLI output).
- Booking assistant E2E: the "only staff see appointments" test now uses a fresh verified account that is not on `ADMIN_EMAILS` (since verified-staff E2E setup, the default owner is staff, so every ai-agents booking build failed E2E).
- **Security, all recipes:** staff/admin access (`ADMIN_EMAILS`) trusted an unverified email, so anyone who signed up
  first with the owner's address became staff. Sign-up now sends a verification link (logged without an email
  provider) and staff rights require `emailVerified`; E2E covers unverified → verified.
- All recipes: a fresh sign-in resumed no workspace and sent returning users to "create workspace"; sign-out added.
- Generated site FAQ could have questions and answers swapped (explicit `question`/`answer` keys + normalisation).
- Templates' `tsconfig.json` include `.next/dev/types` (Next 16 no longer rewrites it).
- Verifier: `server-action-without-authz` no longer flags sign-in/out/up actions; `ai-direct-model-call` catches
  OpenAI-compatible endpoints from env and URLs built from a configurable base; findings labelled security / policy /
  quality (licence policy and secret-shaped test placeholders are policy, still blocking).
- Deploys: one deploy per environment at a time (local lock; parallel agents no longer overwrite each other's staging deploy) and the deployed branch@commit is recorded on the worker and printed before it is replaced.
- `/cli/turbineh.mjs` was missing in production when the CLI build came from cache (turbo restores only `dist/**`): the web build now copies the bundle itself before `next build`.
- Recipe choice: an AI agent specialised in bookings (or support, sales, intake) now maps to `ai-agents` (with the orchestrator) instead of `bookings`; the recipe descriptions given to the decider say so explicitly.
- Licence scan: the SPDX expression was cut one word too far when read from a scan line, so `jszip` (MIT OR GPL-3.0-or-later, via mammoth) blocked builds as unparseable. Whole-line parsing now has its own tests. Staging only; never reached production.
- The corrector never edits the Security Pack (`src/security/`) or the AI orchestrator and AI Safety Pack (`src/lib/ai/`): they are certified code and the only files allowed to talk to models. The direct-model-call rule also covers JavaScript files.
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

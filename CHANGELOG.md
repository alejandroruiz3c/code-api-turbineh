# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- New use cases from real demand (ADR-0073): `content.blog.turbineh` (Markdown posts with frontmatter, drafts,
  authors, tags, search, reading time, RSS, blog sitemap, Article JSON-LD; required by corporate-site, selectable on
  any recipe), `media.screen-recording.turbineh` (screen + camera in the browser, asks up to 4K and records what the
  device delivers, canvas layouts, MediaRecorder, private storage, Range playback, revocable share links) and
  `domain.matching.turbineh` (organization profile, records matched deterministically with reasons, organization
  isolation on pages and API). Base SaaS: organization switcher, second organization, account page. Role assignment
  requests select membership-access. The gate counts the canonical criteria of the domain components code selects
  before it (`gateComponents`), also for requests no product family matched. Canonical criteria and E2E for all.
- Appointment reminders and messaging (ADR-0070): `domain.reminders.turbineh` reminds each confirmed appointment a set
  number of real hours before it (24 by default) by email, SMS or WhatsApp — once per appointment, channel and start
  time, never for cancelled appointments, local time of the business in every text, retries with backoff, a staff
  page — run as a task of the `jobs.scheduled.turbineh` cron route (which now runs components' tasks on every call and
  accepts no job of its own). `messaging.sms.twilio` (Twilio Messages REST API, E.164 with libphonenumber-js, consent
  and STOP, retries, X-Twilio-Signature webhook, logged mode) and `messaging.whatsapp.meta` (Cloud API approved
  templates, opt-in and STOP, retries, X-Hub-Signature-256 webhook with verification, logged mode), contract-tested
  against offline mocks and E2E-tested in the bookings template. Booking forms gain an extension point
  (`src/bookings/extensions.ts`, `form-extras.tsx`) used for the reminder consent boxes. Canonical criteria for email,
  SMS and WhatsApp reminders; the plan and the scope gate see the reminder and messaging components a request asks
  for; SMS/WhatsApp notifications are covered (conversations and bots on them are not); components-only offers for
  SMS and WhatsApp. `libphonenumber-js@1.13.14` is pinned in the saas-crud, ai-agents and storefront templates; new catalogue
  category `messaging`.
- AI agents over the customer's own data (ADR-0072). `email.inbox.imapflow`: one IMAP mailbox read read-only and
  incrementally by UID (app password or OAuth XOAUTH2 from the environment, TLS required, mailparser).
  `ai.mail-triage.turbineh`: every email classified and prioritised through the orchestrator (schema-validated, email
  as data), inbox most urgent first, daily digest on schedule, invoices and payments to a finance ledger (income,
  expenses, investments; totals in cents) with Excel export. `ai.recommendations.turbineh`: preferences captured in the
  conversation, recommendations by code over verified catalogue records only, answers, side-by-side comparison and,
  with bookings, viewings booked after confirmation. Booking agents: a taken time is refused with the free times
  suggested. Canonical criteria, offers and CI combinations for all of them; the ai-agents template lockfile pins
  imapflow 2.2.6, mailparser 3.9.31 and exceljs 4.4.0.

- Contact email for invitation workspaces (ADR-0074): `/access` asks for an email (required, validated, with what it is
  for) and stores it per workspace (`workspace_contacts`, migration 0017); workspaces that entered before are asked
  once per visit by a non-blocking banner (`GET/PUT/DELETE /v1/contact`). New plans and builds carry it as their
  contact email, so uncovered requests can be followed up. "Notify me when it's covered" on the not-covered screen
  saves an email for a refused flow and sends the priority-list confirmation once (`POST /v1/builds/{id}/notify`).
  API `notify_email` on `POST /v1/plans` and `/v1/builds`; CLI `--notify-email` and `turbineh notify [id] <email>`;
  MCP `notifyEmail` and a `notify` tool. Shared workspaces never hold an email; only staff see addresses (owner
  report source `workspace`, demand list).
- Commerce and payments from real demand (ADR-0071). Card payment when booking: new component
  `payments.booking-deposit.turbineh` (deposit — fixed or percent — or full price with Stripe Checkout, cards only,
  amount computed on the server; the booking is held `pending_payment` until the signed webhook confirms it and sends
  the confirmation email once; an expired payment frees the time; a payment for a time no longer held is refunded).
  Selected by code with the bookings domain when a bookings request asks for it; the bookings domain gains a payment
  step extension point (`src/bookings/payment.ts`) and payment holds. Storefront: canonical criteria for paying by card
  on Stripe Checkout with the paid-order confirmation and for refusing a sold-out size, each with a new E2E test; the
  success page shows the paid order to the browser that paid it; wider declared vocabularies for discounts,
  currencies, shipping, Stripe Tax, orders and admin stock (all proven by existing tests).

### Fixed

- The AI Safety Pack no longer redacts dates and times ("2026-10-26 09:00") as phone numbers, which broke booking
  dates sent to the assistant (ADR-0072).
- Scope-gate recall (ADR-0069): requests the library covers are no longer refused at "0 % functional coverage".
  General requirements (runs, verified, sample data, good practices, look and feel, persistence, another stack) are
  listed in the plan with how each is handled and never measured as functions; the stack asked for is never a refusal
  (built on TypeScript + Next.js + PostgreSQL + Drizzle, said in the plan). AI agents get canonical criteria with tests
  for help-centre answers, hand-over to a person (team emailed, "Needs a person" list, honest "emailed"), generated
  lookups and "every AI call through the orchestrator"; projects get archive/restore and tested edit/delete of
  projects and tasks; canonical matching ignores storage phrases, condition negations and people the actor picks, and
  finds two-function pairs; the gate sees the request's domain components. A blog about AI is no longer refused as AI
  generation. Questions about the product ("what can you do?", "¿qué puedo hacer contigo?") get a help answer on the
  API, CLI, MCP and web, with no flow, failed build or demand row. CI guard: every example prompt we show must pass the
  gate as covered. `catalog:snippets --check` no longer fails on a trailing newline.

- Uploaded product images in the storefront failed the gate when `storage.objects.vercel-blob` was selected (a
  model-written glue module with `any` failed lint and typecheck, so the component was removed and the plan's promise
  broken). The storefront now provides `storage.objects` itself: Vercel Blob through the official SDK when
  `BLOB_READ_WRITE_TOKEN` is set, PostgreSQL otherwise (unit-tested against a Blob API stand-in); the component ships
  curated, strictly typed glue and contract tests of `put`/`del` requests.
- Orchestrator audit v2 (ADR-0068, #131): generated agents get read-only `lookup_<entity>` tools and FAQ in their
  knowledge base; escalation emails the team (honest fallback); workspace header validated, cookie CSRF guard, one
  problem format, AI token by API/CLI/MCP, CLI/MCP error and exit-code fixes, minimal public /health; deterministic
  component E2E (client sign-up, public-pages filter, scheduled jobs); wording-independent components-only offers.
- One source of truth for what a flow decides and delivers (ADR-0064, audit v2 F-03/F-11/F-05/Annex A): a delivery
  manifest (`turbineh.delivery/v1`) built from the real selection renders the plan, the result, "Next steps",
  DEPLOY.md, AGENTS.md, turbineh.json (`delivery`, `brokenPromises`), `.turbineh/delivery.json`, the web and the CLI.
  Every decision says what in the request justifies it; the components the code always chose (AI orchestrator, AI
  Safety Pack, domain components) now have a decision, and nothing is decided that the package does not use
  (`ui.table`, `ui.form`, `ops.rate-limit` are the template's own). An approved promise the package does not keep
  is a broken promise — delivered, never "verified" — and plans no longer promise "TurbineH writes it" for what it does
  not write (`ops.idempotency` is "not included", with why, and needs approval). The result's "what is left" and
  settings come from the delivered package (acceptance result and manifest), never from the plan's prediction.
  Every flow records `metrics.consistency`; CI checks 0 contradictions for every recipe.
- Settings: one env schema (`src/env.ts` + declared component settings) gives the same Required / Optional split in
  the plan (with `BETTER_AUTH_*`), the result, DEPLOY.md, AGENTS.md, turbineh.json and the CLI.
- Relevance: only capabilities a requirement of the request (or a transversal requirement: auth, security,
  persistence, interface) justifies are selected — decided by the private engine's `capabilityRelevance`
  (resource-decider 1.2.0), else open rules; the rest is shown as "left out, not asked for". Recipe tree-shaking:
  optional template and component modules ship only when asked for (the public `/assistant` route only with a public
  toolkit); a bookings app no longer gets the public-pages CMS route; the footprint of code linked to no criterion is
  recorded per flow. Private resource decider pinned to v1.2.0 (`capabilityRelevance`).

### Security

- Honest security gate for generated apps (ADR-0065, audit v2 N-02, F-07, F-08, F-10, F-12):
  - A finding counts as "fixed automatically" only when the re-scan after its fix and the final scan no longer find it
    (rule + file + line, deduplicated); attempts that did not work are listed as "Attempted, not fixed". A finding is
    never both fixed and remaining; "Security issues fixed before delivery" (flow page, workspace summary,
    START_HERE.html, TURBINEH_REPORT.md) is that verified count (older flows show "—").
  - XSS (`turbineh.unsanitized-html`) and open redirects in routes, pages, layouts and components are always blocking.
    The public-pages component's JSON-LD suppression now sits on the line Semgrep reports (the bookings CMS route of
    the audit).
  - Auditable corrections: TURBINEH_REPORT.md "How this build was corrected" and the flow page's Check tab list the
    checks of the first pass, every correction (directed, Backup Coder, swap, security fix, repair) with its commit and
    diff, and refused changes. Repairs may not weaken tests, add suppressions (`nosemgrep`, `eslint-disable`,
    `@ts-ignore`…) or edit check configuration: such changes are reverted and reported.
  - "Pass with warnings": passing checks with non-blocking findings are shown as such in SECURITY.md, START_HERE.html,
    AGENTS.md, the badge (`Checks 11/11 (1 with warnings)`) and the API (`checks.warnings`); non-blocking advisories are
    listed as accepted exceptions with the reason, the OSV patched version and a review date. Exceptions policy in
    SECURITY.md.
  - Job queue (`jobs.queue.turbineh`): idempotency keys on `enqueue`, at-most-once side effects per job (`ctx.once`,
    table `job_effects`) and `ctx.idempotencyKey`; concurrency test with two runners on PostgreSQL (PGlite). Catalog test
    that every recipe uses the PostgreSQL-backed rate limiter.
  - `AI_REDACT_PII` defaults to `true` in generated AI apps; `AI_REDACT_PII=false` is the explicit, documented opt-out.

### Fixed

- Public usage snippets compile (ADR-0066, audit F-04): every component's example is generated from its own contract
  test (or a `snippet.ts`) and compiled with `tsc --noEmit` against the pinned versions — 137 TypeScript snippets, 19
  TurbineH module snippets compiled inside the assembled apps, 5 parameter examples validated against their schema, 2
  CLI/API examples checked against real commands and routes. Wrong imports fixed (exceljs and i18next default exports,
  gray-matter, better-auth client subpaths, MCP SDK subpaths, dinero.js currencies, react-colorful…); `import`
  interface signatures taken from the real imports. `pnpm catalog:snippets [--check]`, CI job "Snippets compile",
  `verify:recipe --snippets`; Discover shows "Snippet compiled against <pkg>@<v> on <date>". `files.upload.busboy`
  now declares `@types/busboy@1.5.4`.
- Discover relevance (ADR-0066, audit §5.3): idf-weighted similarity with a minimum (0.25), a cut relative to the
  best result, rerank by capability description; the Discover fallback uses the same ranking. precision@5 on the 20
  reference queries 0.69 → 0.89; 0.90 on 12 held-out queries; enforced in CI (≥ 0.8).
- "Finished in" is `finished_at − started_at` (persisted), the flow page renders the persisted state on the server
  (no "Generating · 0 s" for finished flows), and the home / activity average uses the same formula (ADR-0066, N-03).
- Plan estimates are calibrated per recipe from finished runs: p50–p90 intervals with their basis, benchmark averages
  labelled as such below 5 runs, and estimated vs real in the result (ADR-0066, F-06). Median error on staging
  history: time 16.4 %, lines 21.7 %, tokens 36.9 %.

### Changed

- Generated DEPLOY.md: TurbineH gateway and your own OpenAI-compatible provider as two equal options, what happens
  when the AI endpoint is unavailable, and a DPA/SLA contact section (ADR-0066, F-09).
- Product site: no "In seconds" or unmeasured durations; "Free and open" explained (Apache-2.0 library, invitation
  beta, AI gateway or own provider); supported stack declared on the home page and in the stack selector; "STEP 02 ·
  THE MOAT" removed; "Leave" → "Sign out"; verified pull request into an existing repository on the home page
  (ADR-0066, L-01…L-06).

### Added

- Uncovered use cases explained and, only when real, a components-only offer (ADR-0062): every surface shows what the
  library doesn't cover yet and why, the priority notice and what we can do now (`explanation`). Verified components
  are offered only for functions the person asked for, servable, proved by a verified test (recorded per requirement)
  and confirmed by the resource decision engine (new decision point `componentsServe`; private engine 1.1.0) — never
  generic plumbing, never the use case itself. The offer says plainly what you get and what is not included (the core,
  when it is the core); one action builds it through the component path (`{"approve": true}`, `components_only: true`
  on `/v1/builds`, `--approve`, MCP `resume`), with an honest badge. Labelled set `bench/offers/` (18 requests). A
  refused `POST /v1/plans` (422) now returns the flow `id`.

- Go-validation benchmark (`bench/validation/`, audit report v2 section 9): 30 new labelled statements (band A in a
  covered use case, B a use case plus 1–2 new capabilities, C an uncovered core) with the reviewer's canonical
  requirements and the gaps to warn about, 20 Discover reference queries, a resumable runner over the public API
  (`--env staging|production`, ≤ 3 flows in parallel; plan → approve when asked → generate → collect plan, result,
  `/v1/builds`, manifest.json and turbineh.json) and a scorer that writes `RESULTS.md` with the section 9.2 metrics
  and thresholds (functional coverage, gap-detection recall, false "verified", contradictions between surfaces,
  snippets, precision@5, estimate error, footprint, time p50/p95, cost) plus a review sheet for human confirmation.
  The section 11.3 comparison with Claude Code is prepared, not run (`compare-claude-code.md`).
- Social networks as first-class components (ADR-0067, audit v2 §5.1/§6/§8 P1): `social.connections.turbineh`
  (OAuth 2.0 for LinkedIn members, Facebook Pages + their Instagram professional accounts via Facebook Login for
  Business, X with PKCE; single-use state; tokens AES-256-GCM-encrypted under `SOCIAL_TOKEN_KEY`, bound to their row,
  refreshed, revoked on disconnect, never in CRUD/CSV/logs), `social.publish.turbineh` (LinkedIn Posts API + Images
  API, Graph `/feed`, `/photos`, Instagram `/media` + `/media_publish`, X `POST /2/tweets` + `/2/media/upload`;
  per-network length/format rules incl. X's weighted count, optional approval, scheduling in the author's zone, a
  unique idempotency key per post, claimed runner route with leases, retries with exponential backoff + Retry-After,
  append-only publication log, calendar) and `social.metrics.turbineh` (likes, comments, shares, impressions per
  published post on a schedule; null when a network does not report it). Contract tests against offline mocks of each
  provider's documented endpoints, E2E suites, capabilities `social.oauth`/`social.publish`/`social.metrics`, fidelity
  patterns that select them with the request's networks and approval, and the scope gate now covers LinkedIn,
  Facebook, Instagram and X publishing (autonomy, AI drafts without AI, and other networks stay uncovered).
  `verify:recipe saas-crud+social.connections.turbineh+social.publish.turbineh+social.metrics.turbineh` and
  `verify:spec social-publisher` run them through the full gate.
- Functional coverage, a first-class dimension (ADR-0063; external audit v2 N-01, F-01, N-04, N-05, F-14, N-06):
  - Canonical acceptance criteria: every recipe (and the bookings, workflow, membership-access and audit-log
    components) declares in `criteria.yaml` one criterion per function its catalogue text advertises, linked to the test
    that proves it; saas-crud declares the generated CRUD functions per entity (create, list, edit, delete, CSV
    export/import, search, tag filter, sort, tenant isolation). A CI audit fails when an advertised function has no
    canonical criterion, a linked test is missing or does not prove the wording.
  - The plan replaces a request criterion with the canonical wording when it maps to it (the request's words are kept
    as `asked`); the package links criteria to canonical criteria and their tests; the decider only sees residual
    criteria. The report, ACCEPTANCE.md, turbineh.json and the API now say the same per criterion.
  - `outcome.functional` and the verdict line on the web, API, CLI and MCP; `functional_coverage` in turbineh.json.
    "Verified" without a qualifier only at ≥ 80 % functional coverage: "Technically verified · checks 11/11 ·
    functional 2/5" below. Home/Activity KPIs "Checks passed (flows)" and "Requirements met (aggregate)" replace
    "Flows verified". One source of status texts (`@turbineh/shared` status-texts), word-boundary ellipsis, /use step
    4 "Checked result".
  - Scope gate functional floor: a request where no requirement maps to a verified function is refused (0 %
    functional coverage is never built).
  - Generated E2E per entity: delete, and once per app "a person in another workspace never sees this workspace's
    records" (open sign-up apps). New template tests for advertised functions that were untested (tracker weekly
    totals/history, client-portal client and staff flow, landing confirmation email, analytics manual entry, AI batch
    summarise/extract and allowed tools, storefront uploaded image, projects assignee/priority/due date, bookings "any
    team member" assignment).
  - `bench/functional`: 10 band-A and 10 band-B labelled requests and a staging runner that measures functional
    coverage per band and false "verified".

### Changed

- Library contract tests (`tests/unit/components`) are no longer evidence for any acceptance criterion.

### Added

- Owner usage report across products (ADR-0061): per account for the YES IF library (identity, channels, flows,
  outcomes, checks, requirements, capabilities/components, time to verified, downloads, pull requests, deploys,
  uncovered requests, AI use of generated apps) and Intelligence Orchestration (requests, tokens, p50/p95, cost,
  frontier reference, savings, trial, surfaces), a combined per-person view, totals and week-over-week. Staff page
  `/ops/report` (sortable, CSV, "email me now"; `/ops/users`, `/ops/orchestration`), `GET /v1/ops/owner-report`,
  `POST /v1/ops/owner-report/send`, `pnpm --filter @turbineh/db owner-report` / `orchestration-report`, and a weekly
  email every Monday 08:00 Europe/Madrid (Vercel Cron → `GET /v1/cron/owner-report` with `CRON_SECRET`, once per ISO
  week; staging runs dry). Flows now record their channel (`options.channel`) and package downloads are counted
  (migration 0016). Staff sign-in with GitHub at `/ops/sign-in`; platform emails support attachments.
- Measurable orchestration (ADR-0060): every orchestrated chat, `/orchestrate`, `/agent`, direct chat answer and MCP
  `orchestrate`/`chat` result reports this request's `latency_ms`, tokens, `cost_usd` (as charged to the trial), the
  same tokens at a frontier model's list price (`frontier_reference_cost_usd`) and `savings_usd`/`savings_pct`
  (`turbineh.metrics`, `structuredContent.metrics`, `X-TurbineH-Latency-Ms`, `X-TurbineH-Cost-USD`,
  `X-TurbineH-Frontier-Reference-Cost-USD`, `X-TurbineH-Savings-Pct`); cumulative per account in
  `GET /v1/ai/v1/usage` and the MCP tool `usage_report` (migration 0015 `ai_request_metrics`).
- The gateway forwards the OpenAI-compatible `reasoning_effort` and reports `finish_reason` to the engine; an engine
  `NO_ANSWER` is answered 502 `no_answer`; JSON mode on the orchestrated chat is validated structured output.

### Fixed

- Components-only offer with the social components (ADR-0062 §7, ADR-0067): publishing with a person in the loop is
  offered for social-publisher requests (never a generic scheduler next to it; a hint may supersede generic
  capabilities), and the labelled set gains two social requests. Main CI was red after #124: the precision test and the
  owner's-case expectation are updated with evidence (engine precision 1.000 on 20 requests).
- Scope gate: the private engine's question saw only the first 60 catalogue components, so requirements served by
  later ones (payments, PDF, QR…) were judged outside the library; the worker now sends the whole catalogue with
  capabilities and keywords and the engine (resource-decider 1.1.1) picks the relevant components per requirement.
- Staff pages and `/v1/ops/*` recognise a staff GitHub sign-in in a browser that also has the invitation cookie
  (before, `/ops` was a 404 for staff in the browser).

### Changed

- Private agent orchestrator pinned to v1.1.0 (its ADR-0004): no reasoning on the fast route and in planning, bounded
  reasoning on larger routes, never an empty answer, agent steps on the fast route without reasoning.

- Intelligence Orchestration as a product (ADR-0059): `POST /v1/ai/trial-signups` provisions a build-less trial
  account and an orchestration token for the landing page's "try it free" form (server-to-server,
  `ORCHESTRATION_SIGNUP_SECRET`; rate limited per email, client IP and day; repeat signups rotate the token and keep
  the $2 balance); a remote MCP server at `/v1/ai/mcp` (Streamable HTTP, stateless; tools `orchestrate`, `chat`,
  `trial_status`); orchestrated routing on the OpenAI-compatible chat endpoint (`model: "turbineh-orchestration"`);
  `X-TurbineH-Trial-Remaining-USD` on every gateway response; trial listing (`pnpm --filter @turbineh/db trials`,
  `GET /v1/ops/trials`); connect guide in `docs/INTELLIGENCE_ORCHESTRATION.md`.

### Changed

- Resource decisions behind a private engine (ADR-0058): the decision questions, prompts and thresholds (selection,
  compiler intent and Abuse Guard, scope gate, entity kinds, monorepo app choice, remediation, criterion evidence, T3
  business rules), the decider backends, the AI gateway's hedging policy and the open decider service moved to the
  private package `resource-decider` (pinned in `infra/private/versions.json`, required by web and worker).
  `@turbineh/decider` keeps the interface, the public decision API client and an open minimal fallback (deterministic
  heuristics), so the open library builds, tests and runs without it. Production decisions are unchanged; workers
  refuse to start without the private engine.

### Security

- Generated apps (ADR-0054, external audit of a `saas-crud` app; catalogue-wide):
  - Secrets (token, secret, password, API key, refresh token, credential, private key…) are never generated as a
    column, form field, list cell, CSV column, prop or log value; each is reported as not covered (`SEC-…` id).
  - Roles: invited members never inherit an admin-like role (a single named role is owner/admin; members get read and
    create); approve, export and configure are separate privileges; unknown or missing roles and failed membership
    lookups are denied.
  - Permission tests use fixed expectations written at assembly time plus fixed negatives for members; every repair
    loop (corrections, Backup Coder T4, post-remediation repairs) deterministically reverts changes that delete, skip
    or weaken a test or edit an assertion of a fixed oracle.
  - Every rule of the request is code, a listed limitation or a blocked item with an id in TURBINEH_REPORT.md. Status
    and lifecycle fields are no longer typed in forms: role-gated transitions change them.
  - References are tenant-scoped foreign keys resolved by the server; no editable tenant ids; one source of length and
    range limits (non-negative numbers, enum checks in the database); date-times stored in UTC with their IANA zone; a
    change and its audit entry share one transaction; exports refuse instead of truncating; production requires an
    email provider (or `EMAIL_DELIVERY=disabled`) and links are never logged; the rate limiter is shared (PostgreSQL,
    TTL) and trusts `X-Forwarded-For` only through `TRUSTED_PROXY_HOPS`.

### Added

- Platform email (ADR-0056, amends ADR-0052 §4): a request the scope gate refuses (or covers only in part) now gets one
  email to the person who asked — "We don't cover this use case yet. You're on the priority list and we'll email you
  as soon as it's available", with the requirements not covered — and one short alert to the owner
  (`DEMAND_ALERT_EMAIL`, default alex.ruiz@turbineh.com). Sent through Resend's API with plain `fetch` from
  `TurbineH <support@turbineh.com>` (`RESEND_API_KEY`, `EMAIL_FROM`; without the key: one warning, nothing sent), after
  the response and once per demand row (migration `0013_demand_email.sql`: `confirmation_sent_at`, `owner_alerted_at`,
  `available_notified_at`).
- `pnpm --filter @turbineh/db notify-available <ids…> | --capability <text> [--message <text>] [--send]`: the owner
  tells everyone whose request is now covered (one email per address, rows marked notified, dry run by default).

### Changed

- Private orchestration engine (ADR-0057): it is now its own private repository, consumed at a pinned release instead
  of an unversioned local checkout. `infra/private/versions.json` pins each private package (`repo`, `tag`, `commit`,
  `requiredBy`, optional `contract`; no code) and `infra/private/sync.sh` checks it out at `private/<name>`, verifying
  that the tag resolves to the pinned commit, the checkout is clean and the vendored interface matches
  `packages/orchestration/src/types.ts`. The web app loads the engine from `private/agent-orchestrator` (was
  `private/orchestration`, no longer supported); `infra/staging/deploy.sh` syncs and verifies the packages each target
  requires before deploying anything and prints their versions; `.vercelignore` uploads every pinned checkout without
  git data, dependencies, benchmarks or coverage; CI validates the pins file.
- Scope gate (ADR-0052, supersedes ADR-0050 §4, owner rule): TurbineH only operates requests whose use case the library
  covers — a covered recipe, or verified components the request maps to or the person chooses (`components` in
  `POST /v1/plans`, `--components` in the CLI, `components` in MCP). The gate reads the compiled requirements and the
  request's headline: code flags uncovered platform integrations, autonomous actions, native/hardware apps and AI in
  use cases without AI; the decider judges the rest in one batched request. An uncovered request is not built:
  `use_case_not_covered` — "The library doesn't cover this use case yet. We'll notify you with priority as soon as it
  does." — with `notCovered` (web, API, CLI exit 5). A partially covered request lists what is removed from scope and
  needs an explicit choice to build only the covered part ("Build only the covered part", `{"approve": true}`,
  `--approve`; `covered_only: true` on `POST /v1/builds`). The audit's "autonomous social media publisher" is refused
  instead of being built as a CRUD app.
- Agent instructions (`turbineh init` block, Claude Code skill, MCP instructions) and `/use` state the rule and how to
  pick explicit components.
- AI orchestration (ADR-0053): a $2 trial per TurbineH account across all its AI apps (`AI_TRIAL_CAP_USD`). Every
  gateway call adds its internal cost to the account (atomic); once the cap is reached the gateway answers 402
  `trial_limit_reached` — "You've reached the trial limit of the TurbineH orchestration ($2). Contact
  alex.ruiz@turbineh.com to continue." — and generated apps show that message (assistant widget, `/api/assistant`
  402). The build page shows the remaining trial balance.
- Component `ai.orchestrator.turbineh` 0.4.0 (ADR-0053) is a thin client: each agent step and each orchestrated request
  is one call to the gateway (`/v1/ai/v1/agent`, `/v1/ai/v1/orchestrate`), which orchestrates it; tools, confirmations,
  safety guards, usage and audit stay in the app. `AI_BASE_URL` without a TurbineH token runs a plain local tool loop.
- The orchestration engine is private (`private/orchestration`, git-ignored; see `docs/PRIVATE_ORCHESTRATION.md`); the
  public repo keeps its interface and an open minimal fallback (`packages/orchestration`). Production web builds and
  `infra/staging/deploy.sh` refuse to ship without the private engine.
- Delivered apps no longer contain trigger ids, model names or decision probabilities (Backup Coder header,
  COMPONENTS.md, report metrics and footer, capability package docs, handover gaps).

### Added

- Demand for uncovered use cases (`0011_use_case_demand.sql`): every refused or partial request is recorded with the
  missing requirements, and its owner is subscribed to a priority notification. Staff read it at `GET /v1/ops/demand`
  or with `pnpm --filter @turbineh/db demand`.

### Fixed

- Audit F18: the state badge separates build checks from requirements ("Checks 11/11 · Requirements 6/8 met") on the
  web, the API (`outcome.badge`) and the CLI; "Package verified" is never shown alone while requirements are open, and
  settings and unmet requirements are separate panels.
- Audit F20: the quickstart comes from the delivered app's real files and scripts (no `pnpm db:seed`, `.env.example` at
  the root); generated AGENTS.md no longer points open criteria to a non-existent `tests/e2e/app.spec.ts`.
- Backup Coder limits (ADR-0055, audit F09/F08): the Backup Coder never reimplements a capability an approved
  catalogue component provides (a hand-written cron scheduler shipped next to `jobs.scheduler.croner`): the selector
  keeps approved providers the decider judged as not covering unless they are risky, and `fillGap` refuses catalogued
  capabilities in code. Its output is refused deterministically when it contains a non-cryptographic hash (a 32-bit
  string hash was used for idempotency keys) or demo/placeholder code; idempotency and deduplication need persistence
  and a unique constraint, so they are reported as not covered instead of generated. Backup Coder code is labelled
  "not catalogue-verified" in COMPONENTS.md, TURBINEH_REPORT.md, AGENTS.md and `turbineh.json`.
- `jobs.queue.turbineh` (ADR-0055, audit F07): leases with expiry, heartbeat and a fencing token; jobs left `running`
  by a crashed runner are reclaimed or failed (`LeaseExpired`); a runner whose lease was taken over never writes its
  result. Behaviour contract in the component's `acceptance.yaml`, tested with an in-memory store.
- CLI login and installer (ADR-0055, audit F22): `turbineh login` asks for the token without echo, `--with-token`
  reads stdin, or `TURBINEH_TOKEN`; the positional token is deprecated (warning). `install.sh` installs a pinned version
  and verifies its SHA-256 before installing; the CLI build publishes `turbineh-<version>.mjs`, `SHA256SUMS` and
  `release.json`. /use shows download, then run, then `turbineh login`.
- Gate reports in the delivered package (ADR-0055, audit F19): `.turbineh/reports/` with `gate.json` (every step's
  time, a note for steps without their own duration, skipped steps with the reason), `static.sarif`, a lockfile
  dependency list with scopes and JUnit files from vitest and Playwright. `turbineh.json` and AGENTS.md carry the same
  notes. The `braces` advisory GHSA-vfj7-8cjw-p6xm has no fixed version yet (3.0.3 is the latest and last affected);
  it stays a development-only, non-blocking alert.

- Flows (ADR-0051): the flow page always reaches an end state. A capability package for a repository (production flow
  `470bc606`, finished in 1.5 s) stayed on "Assembling verified components · Packaging" because the page rendered a
  result only for an app ZIP or a failure. It now shows "Package ready (not verified yet: it is verified inside your
  project when you integrate it)" or "verified" with Open a pull request, Download ZIP, `turbineh apply` (and what it
  does) and what is left. The page loads the row first (late subscribers), re-follows when `finished` races the row,
  reconnects, and polls the API after 15 s without events.
- Component plans (ADR-0051) select only what the need asks for: "HTTP client with retries and timeouts" no longer adds
  a cart store, react-query, fuzzy search, email and a request queue; "generate", "model" or "extract" no longer pull
  the AI orchestrator. Precision on 10 labelled single-capability needs: 22.2 % → 100 % (`bench:component-plan`).

- Flows (ADR-0050): after "Generate & verify", the flow page no longer reports "A check did not pass, so nothing was
  delivered" while the app is still being built — the live trace ended at the plan's own `finished` event (production
  flow `0bfd9dff`, verified 11/11, shown as failed). Failures now say what happened, why, what to do, with one button
  ("Generate again" resumes from the approved plan) — web, API (`problem`) and CLI.
- Stack-only flows (ADR-0050): "Next.js" from the wizard was read as an incompatible "next.js" and generation was
  disabled. A declared stack now builds a complete app ("A complete Next.js app, built for you"), with one-click
  choices: generate, build a complete Next.js app instead (other stacks, with what they get stated plainly), add to my
  repository, use my project's files. Unknown use cases are built on the closest template with "what is left" and
  where, instead of failing out of scope.

### Added

- Live flow messages (ADR-0051): what runs now in plain words with live details (components by name, glue written,
  the gate check running and its order, results, passed-test counts), elapsed time, typical duration per step
  (`GET /v1/activity/timings`, medians of recent flows), steps done / now / next, and after 20 s of silence "Still
  running…, keep this page open or come back later" with a link to Activity. New events: `assembling start`,
  `integrating progress`, `verifying step` (every gate step and the security scans).
- Capability packages run their components' contract tests together in the sandbox at generation (ADR-0051):
  `verified` only when they pass. `FlowResult.outcome` and `/v1/builds/{id}` `state`/`outcome`/`package` say the same
  as the badge and the CLI.

- Product web: the home page ends with "Checks every package passes" — secrets, security rules, safe dependencies
  (known vulnerabilities and licence policy), the AI Safety Pack and tests in the sealed sandbox, as the gate runs
  them. /use is shorter: people and the coding-agents intro stay visible; Coding agents · CLI, MCP and API are
  accessible disclosures, opened by click, keyboard or the URL hash (/use#mcp; /cli and /docs still land on #agents
  and #api). The list of complete flows left /use for its own main-navigation item, Catalogue (/catalog, from the
  engine's USE_CASES); Discover stays the search by need, and /catalog?q= still goes to it.
- Recipe actor aliases (ADR-0049): recipes declare in `aliases.yaml › actors` who their tests act as, from their role
  model (storefront, corporate-site, landing-waitlist: owner = administrator/admin/staff; client-portal: owner =
  staff), and the request's role matrix adds the owner's label; both apply only to recipe and generated tests that name
  the role (replacing the blanket "acting as"). The staging shop's two "administrator" criteria are now proven by owner
  tests that assert them; precision stays 1.00.

- Criteria aliases (ADR-0047): domain components declare in `aliases.yaml` which params hold this app's word for
  the generic words their tests use (bookings: customer → patient, staff member → physiotherapist, business → clinic,
  services; workflow: record → piece, status → stage). The assembler resolves them per app (`.turbineh/aliases.json`)
  for that component's tests only; facts count only when the test asserts the value from params; aliases never satisfy
  a refusal. New params from the request: bookings `businessKind`, workflow `stateNoun`. Frontiers ai-agents +
  bookings spec 1/14 → 5/14; 109 labelled pairs stay at precision 1.00, recall 0.92.

- Agent brain speed (ADR-0046): runAgent answers a confirmed irreversible action that ran from a template (the tool's
  `message`, else the confirmed summary and reference) without a decider or model call, and bounds each model attempt
  (15 s, one retry when stuck) and each decision attempt (5 s, one retry). On the 54-conversation agent bench, same
  day: 54/54, turn p95 6.72 → 4.66 s, max 11.96 → 9.37 s, −23 % chat calls, −35 % decider calls, cost 2.08 → 1.40 USD
  per 1,000 conversations [est.] (`bench/agent-brain/RESULTS.md`). The AI gateway can hedge slow chat completions
  (one duplicate, per-app daily budget, billed on the answer only, `hedges`/`hedge_wins` in the usage metrics,
  migration 0010); off by default because it showed no gain. The bench meters hedges, templated replies and network
  failures, and can rotate a staging app token at its daily quota.
- Criteria recall (ADR-0045): recipe, domain-component and generated test titles state the subject, actor and outcome
  they prove, assertion messages count as proof, and missing assertions were added (product detail page and delete,
  order email content, Kanban status persisted, owner role at sign-up, list search, audit trail of an edit). The
  matcher is not relaxed: on the 109 labelled pairs precision stays 1.00 and recall goes from 0.62 to 0.92;
  `verify:spec` Fieldnote 0/11 → 9/11, Kilnwise 0/6 → 1/6, Pixelyard 1/7 → 2/7 met; storefront Frontiers spec 7/7.

- Domain components, part 2 (ADR-0048): `storage.private-uploads.turbineh` (limits and types from params, local disk
  or S3-compatible storage with SigV4 and an offline mock, per-scope authorised downloads, staff email on client
  uploads), the bookings recipe on `domain.bookings.turbineh` (public `/book` page, cancel link with the notice policy,
  staff day/week calendar per team member, time off, staff move/cancel with customer emails; the recipe's own booking
  code removed) and `jobs.scheduled.turbineh` (cron route protected by `CRON_SECRET`, idempotent runs, overdue and
  daily email digests). New seams: `src/server/body-limit.ts`, `src/workflow/extras.tsx`, `src/workflow/board.tsx`.
  Group 2: `ui.kanban.turbineh` (accessible drag-and-drop and keyboard board over workflow states),
  `site.public-pages.turbineh` (public collections with filters, a page per entry, SEO, sitemap, Open Graph images),
  `growth.waitlist.turbineh` (double opt-in, position, referral boost, CSV export) and
  `data.analytics-import.turbineh` (all-or-nothing CSV import with a report, periods, comparisons, per-scope access,
  chart CSV exports). Every component is declared for its recipes and accepts the fidelity patterns' params, so the
  learning-round requests select it (ADR-0044). Checked combinations: Ledgerline, Sala Nueve, Pixelyard, Brickline,
  Orbit Notes, Altamira, Brightside.
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

# ADR-0048 · Domain components, part 2: uploads, bookings recipe, scheduled jobs, kanban, public pages, waitlist, analytics import

- Status: accepted (on `feat/domain-components-2`; 0048 follows ADR-0045 criteria recall, ADR-0046 agent speed and
  ADR-0047 criteria aliases on `main` — it may need renumbering at merge if another branch takes it first)
- Date: 2026-10-13
- Context: learning round (`bench/frontiers/ANALYSIS.md` §12 on `wip/frontiers-bench`, G1) and the "What is left" list
  of PR #92 / ADR-0041. Coding agents rewrote, in every run, private uploads with limits from the spec, the booking site
  (public page, cancel link, staff calendar, time off), scheduled email digests, drag-and-drop boards, public pages per
  record, waitlist mechanics and analytics import with validation. ADR-0041's pattern (params schema, seams, adapters,
  checked combinations) applies unchanged; this ADR records the components and the few new seams.

## Decision

### Components (each: `params.schema.json` + `params` in component.yaml/guide.yaml, contract unit tests, an E2E spec whose titles state the criteria, `acceptance.yaml` rules pointing at shipped tests, AGENTS.md extension points, a checked combination)

1. **`storage.private-uploads.turbineh`** — size, types (recognised by content) and files per record from params;
   bytes outside `public/`: local disk (`UPLOADS_DIR`, development, unit tests, one server) or any S3-compatible bucket
   (`S3_*`; SigV4 implemented in a few unit-tested functions, no SDK). Every read goes through
   `GET /dashboard/files/<id>/download`, which checks workspace and record scope (`record-access` `canSeeScope`).
   Offline mock `tests/e2e/mocks/S3_BASE_URL.mjs` re-verifies every signature with an independent implementation; when
   it runs, `playwright.config.ts` gives the app throwaway S3 credentials, so E2E exercises the production driver.
   Optional staff email when a client uploads. A file's scope is always its record's (`src/uploads/subjects.ts`),
   never the form's.
2. **Bookings recipe on `domain.bookings.turbineh`** — the recipe `requiredComponents` the domain and `detectDomains`
   selects it for recipe `bookings` (services listed with their own durations and prices, `askPhone`). The recipe's own
   booking code (UTC CRUD, availability table, calendar) is removed; it keeps only its home page. The component gains a
   public `/book` page (`publicAction`), a cancel link (hashed single-use token, notice policy from params), staff
   day/week calendar per team member, time off (blocked times are never offered; refused while bookings fall inside)
   and staff move/cancel with customer emails. `ai-agents + domain.bookings` keeps its assistant suite.
3. **`jobs.scheduled.turbineh`** — jobs from params (id, kind, five-field cron, IANA time zone); a cron route
   `GET|POST /api/cron/run` protected by `CRON_SECRET` (`x-cron-secret` or Vercel Cron's Bearer, constant-time);
   idempotent runs keyed by (job, latest scheduled instant) under a unique index, failed runs retried; digests
   (overdue/stuck records to their creator, daily attention digest to members who manage the workspace) through
   `sendEmail`, logged without a provider.
4. **`ui.kanban.turbineh`** (requires domain.workflow) — a board per workflow, one column per state; cards move by
   native drag and drop or with the keyboard alone (Space, arrows, Enter/Space, Escape) with every step announced in a
   live region; each move is the same server-checked transition as on the record page; refused moves put the card back.
5. **`site.public-pages.turbineh`** — public collections from params (`pages[]: entity, path, detail, filters`): a list
   per collection filtered by its fields, a page per entry with metadata, canonical URL, JSON-LD and a `next/og` Open
   Graph image in the brand colours, published pages in the sitemap; staff edit entries; drafts never show. On
   corporate-site (`files-recipe/`) the pages use its SiteShell, menu and sitemap.
6. **`growth.waitlist.turbineh`** — `publicAction` join (same answer for known emails), double opt-in confirmed by a
   button on the emailed link's page (mail scanners never confirm), position by confirmation time, referral link and
   a boost of N places per confirmed referral (pure, unit-tested rule), staff list with CSV export and removal. It
   keeps the landing-waitlist form and action names, so the recipe's page works unchanged.
7. **`data.analytics-import.turbineh`** — CSV columns from params (date, dimensions, measures inferred from names),
   every row validated before one insert transaction (all or nothing, report of line, column and reason), totals vs
   the previous period, measures by day/week/month/quarter/year, top values per dimension, comparison between scope
   values, chart CSV exports with the same filters, per-scope access through `record-access` (a shop manager sees and
   imports only their shop).

### Selection by the fidelity wiring (ADR-0044)

Each component declares its recipes (`use_cases`, guide `compatibility.recipes`) and its `params.schema.json` accepts
the parameters the compiler's patterns produce (MIME types for uploads, a job kind inferred from its words, the
informative board fields of kanban, the pattern shapes of waitlist, public pages and analytics), so the nine
learning-round requests select them with no adapter. domain.bookings is declared for recipe bookings (and accepts
`businessKind`, ADR-0047). The pipeline also requires what a required component requires (ui.kanban →
domain.workflow, `apps/worker/src/required-components.ts`): with the request's parameters when the fidelity output has
them (the workflow is built from the board's entity and columns and validated against its schema), otherwise with the
shipped defaults and an entry under AGENTS.md "What is left" ("workflow states not specified; using defaults").

### Criteria recall and aliases (ADR-0045, ADR-0047)

- The bookings recipe's own tests are gone with its code; the component's E2E titles state the Sala Nueve criteria
  (customer and staff member as actors) and a new test proves "a booking outside the opening hours is rejected".
  `aliases.yaml` of domain.bookings now covers `tests/e2e/bookings.spec.ts` too.
- New `aliases.yaml`: storage.private-uploads (allowed type ← `types[]`/`extensions[]`, asserted from `params.types`;
  record ← `attachTo`), ui.kanban (card ← `entity`, status ← `field`), data.analytics-import (filters ← `filters[]`).
  growth.waitlist declares none: its params hold no words of the request (only switches and a number).

### New seams and template changes

- `src/server/body-limit.ts` (base): the server-action body limit read by `next.config.ts`; uploads replace it with
  `maxBytes` + 1 MB so an oversize file reaches the code that refuses it clearly. client-portal's own
  `next.config.ts` override is replaced by its own `body-limit.ts`.
- `src/workflow/extras.tsx` and `src/workflow/board.tsx` (domain.workflow): extra sections of a record page (uploads
  adds the record's files through `files-with/domain.workflow.turbineh/`) and the board of a workflow (ui.kanban
  replaces it). `src/jobs/digests.ts` is replaced the same way when the workflow is present.
- `playwright.config.ts` (base): S3 mock block and a per-run `CRON_SECRET`; `.gitignore` ignores `.data/`.
- A recipe whose domain lives in a required component still ships a `template/` (the bookings home page): the
  assembler copies every template of the chain.
- `COMPONENT_COMBINATIONS` gains Ledgerline (client-portal + membership + uploads + workflow), Sala Nueve (bookings +
  domain.bookings, replacing the AI probe for that recipe) and Pixelyard (internal-tool + workflow + jobs.scheduled),
  each with the request and the params a compiler would write.

## Consequences

- The learning-round requests above assemble into packages whose E2E suites prove the criteria the agents rewrote.
- The compiler's fidelity patterns (ADR-0042) describe these patterns with their own parameter shapes; mapping them
  onto these schemas is the job of the fidelity wiring (branch `feat/fidelity-wiring`), not of this change.
- Limits: uploads pass through the server (no pre-signed or multipart uploads); scheduled jobs need an external
  scheduler and catch up only the latest missed occurrence; workflow records have a creator, not an assignee, so
  overdue emails go to the creator; time off is not locked against a booking racing it in the same instant.

# ADR-0045 · Domain components, part 2: uploads, bookings recipe, scheduled jobs, kanban, public pages, waitlist, analytics import

- Status: accepted (in progress on `feat/domain-components-2`; the number may need renumbering at merge if another
  branch takes 0043 first)
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
4. Group 2 (`ui.kanban`, `site.public-pages`, `growth.waitlist`, `data.analytics-import`): see the PR; this ADR is
   extended as each lands.

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

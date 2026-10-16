# ADR-0061 · Owner usage report across products (YES IF library + Intelligence Orchestration)

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: the owner asked to see the cumulative report per user, to receive it by email every week and to know how
  to open it whenever he wants — for both products: the YES IF open library (web flows, CLI, MCP, API) and
  Intelligence Orchestration (ADR-0059/0060). The data was spread over `builds`, `use_case_demand`, `ai_apps`,
  `ai_request_metrics`, `ai_owner_spend` and the trial tables; `/ops` showed fleet numbers only, and in a browser the
  staff check never matched (the invitation cookie made every browser caller a workspace, so `/ops` was a 404 even
  for the staff email).

## Decision

1. **One deterministic report** (`packages/db/src/owner-report.ts`, SQL only, no model), over a window
   (`since`/`until`, default since the beginning) plus the last 7 days vs the 7 days before (ending at `until`):
   - **Library, per account** (`builds.owner_id`, plus accounts with uncovered requests): identity (email from the
     orchestration trial, the GitHub sign-in, the priority list, the demand row or the build's contact email, in that
     order; GitHub login; otherwise the owner id), account kind (user / workspace / API key), first seen, last activity,
     flows per channel, plans / packages / app builds / improvements, verified, delivered-unverified, failed, not
     covered (`use_case_not_covered`: a demand row for the flow), in progress, checks passed/total, requirements met /
     open, capabilities (plan capability or recipe) and components, mean time from queueing to a verified result,
     package downloads, pull requests, pushes to GitHub, deploys, local applies, uncovered requests, and the AI gateway
     use of the apps they generated (apps, calls, tokens, account spend). "Verified" mirrors `flowState`: a package
     whose own checks all passed (certification-only does not count) or an app delivered as `verified`.
   - **Orchestration, per account** (trial accounts + every account with measured gateway requests): email, name,
     company, use case, signup date and count, last activity, requests (failed), model calls, tokens in/out, p50/p95
     latency (successful requests), cost, frontier-reference cost, savings $ and %, trial cap/spent/remaining/reached
     (no cap for exempt owners), and requests + cost per surface (API chat incl. direct chat, orchestrate, agent, MCP).
   - **People**: accounts with the same email are one person; each row says which products they use and the key
     numbers of each.
   - **Totals and week-over-week** per product: library new/active accounts, flows, verified, failed, not covered,
     uncovered requests, downloads, pull requests, deploys; orchestration new signups, signups, active accounts,
     requests, failed, model calls, cost, reference cost, savings.
2. **Minimal new recording** (migration `0016_owner_report.sql`): flows record `options.channel` (`web` | `cli` | `mcp`
   | `api`) from the request (`turbineh-cli/<v>` user agent, `turbineh-cli/<v> mcp` from `turbineh mcp`, any other
   Bearer = API, else web); earlier flows read as `unrecorded` (or `api` when an API key started them). Downloads of
   `GET /v1/plans/{id}/package` are counted in `flow_downloads` (numbers only); ZIP links inside status responses go
   straight to object storage and are not countable. There is no platform waitlist table to match.
3. **See it anytime** (TurbineH staff only; everyone else gets a 404): the page `/ops/report` (tabs People / YES IF
   library / Intelligence Orchestration, windows all time / 30 d / 7 d, sortable columns, CSV download, "Email me this
   report now"), short links `/ops/users` and `/ops/orchestration`, linked from `/ops`;
   `GET /v1/ops/owner-report?since=&until=&days=&format=json|csv&view=people|library|orchestration`; and
   `pnpm --filter @turbineh/db owner-report [--days N] [--product …] [--json|--csv]` (`orchestration-report` = the
   orchestration view).
4. **Staff access fixed** (`apps/web/src/server/staff.ts`, used by `/ops`, `/ops/report` and every `/v1/ops/*`): same
   lists as before (`OPS_ADMIN_EMAILS` for a GitHub sign-in, `OPS_OWNER_IDS` for API keys), but a request without
   `Authorization` also checks the GitHub sign-in session directly, so a staff member keeps the invitation cookie and
   is still recognised. `/ops/sign-in` starts the GitHub sign-in (better-auth social sign-in, the existing OAuth app)
   and returns to `/ops/report`.
5. **Weekly email** (`packages/db/src/owner-report-email.ts`, Resend as in ADR-0056, now with attachments): TurbineH
   brand (navy page, cream cards, amber button), both products' KPIs this week vs previous, top people, top library
   and orchestration accounts, a link to `/ops/report`, and `people.csv`, `library.csv`, `orchestration.csv` attached.
   Recipient `OWNER_REPORT_EMAIL` (alias `ORCHESTRATION_REPORT_EMAIL`, default `alex.ruiz@turbineh.com`).
   - **Schedule**: Vercel Cron (`apps/web/vercel.json`) calls `GET /v1/cron/owner-report` on Mondays at 06:00 and
     07:00 UTC; the route sends only from Monday 08:00 Europe/Madrid, so the 06:00 UTC run sends in summer (CEST) and
     the 07:00 UTC run in winter (CET). Auth: Vercel's `Authorization: Bearer $CRON_SECRET` (constant-time compare;
     no `CRON_SECRET` → 404).
   - **Once per ISO week**: the run claims `owner_report_sends (period, 'weekly')` before sending (insert, or retake a
     failed row up to 3 attempts, or a `sending` row older than 15 minutes); Resend's `Idempotency-Key` is
     `owner-report-<week>-<attempt>`.
   - **Staging**: the same `vercel.json` runs on the staging project, but outside `software.turbineh.com` the cron
     builds the report and sends nothing (`dry_run`), so the owner never gets two weekly emails; `OWNER_REPORT_CRON_SEND=1`
     enables it. "Send now" on staging does send, with the subject prefixed `[STAGING]`.
   - **Send now**: `POST /v1/ops/owner-report/send` (staff only; from the browser it must be same-origin) emails the
     report immediately and does not count as the weekly send.

## Consequences

- The report carries contact data and internal cost: it never leaves staff surfaces and the owner's inbox. CSV cells
  are formula-neutralised.
- Channels and downloads are exact only from this release on; earlier flows show `unrecorded`.
- `trial.spentUsd` and the library's `aiSpentUsd` are the account's all-time spend; `costUsd` counts measured
  requests in the window (ADR-0060).
- The report is computed on request (a few aggregate queries); if it gets slow, a materialised daily snapshot can
  replace it without changing the surfaces.
- Tests: `packages/db/src/owner-report.test.ts` (people linking, CSV, ISO weeks and the Madrid schedule across DST,
  email content and escaping, send paths, and the real SQL on a fresh Postgres database with `TEST_DATABASE_URL`,
  including the once-per-week claim), `apps/web/src/server/owner-report.test.ts` (channel, staff access behind the
  invitation cookie, report endpoint JSON/CSV, send-now, cron secret/schedule/staging dry run).

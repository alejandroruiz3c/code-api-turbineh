# ADR-0056 · Platform email: priority-list confirmations and demand alerts (Resend)

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Amends: ADR-0052 §4 ("No confirmation email is sent")
- Context: ADR-0052 refuses requests the library does not cover and promises "We'll notify you with priority as soon
  as it does", but the platform had no outbound email, so nobody was told they were on the list and the owner only saw
  demand by querying `GET /v1/ops/demand`. The owner approved email through Resend, where `turbineh.com` is already a
  verified sending domain (it is used by the landing site), so this adds no new vendor.

## Decision

1. **Channel.** `packages/shared/src/email.ts` calls Resend's HTTP API (`POST https://api.resend.com/emails`) with plain
   `fetch` — no SDK. Configuration: `RESEND_API_KEY` (optional), `EMAIL_FROM` (default
   `TurbineH <support@turbineh.com>`), `DEMAND_ALERT_EMAIL` (default `alex.ruiz@turbineh.com`), and the link base
   `EMAIL_APP_URL` or `BETTER_AUTH_URL` (default `https://software.turbineh.com`). Without the key nothing is sent and a
   single warning is logged per process. Only TurbineH's own notices use it; generated client apps never do.
2. **Priority-list confirmation.** For each `use_case_demand` row (uncovered or partial request, ADR-0052 §4) whose
   person has an email (the account email, or the one on `priority_notifications`), one email: "We don't cover this
   use case yet. You're on the priority list and we'll email you as soon as it's available", with the request and the
   requirements not covered. All user text is HTML-escaped; the subject never contains user text.
3. **Owner alert.** One short email per demand row to `DEMAND_ALERT_EMAIL`: status, use case, who asked, the request
   and the missing requirements.
4. **Never in the response path, exactly once.** The web schedules the emails with Next.js `after()` when it serves a
   refused flow (`GET /v1/builds/{id}`, `GET /v1/plans/{id}`, `POST /v1/plans` when it waits for the result, the flow
   page); the worker also triggers them, unawaited, right after it finishes the flow (only if its host has the key).
   Each send is claimed in the database first (`confirmation_sent_at` / `owner_alerted_at` set by one conditional
   `UPDATE … RETURNING`, migration `0013_demand_email.sql`), so concurrent callers send once; a failed send clears the
   timestamp for a retry, at most 3 attempts. Resend's `Idempotency-Key` (`demand-confirmation-<id>`) guards a retried
   HTTP call. Rows older than 2 days are never confirmed (no burst of emails for old demand). The worker now records the
   demand row before marking the flow finished, so the web always finds it. Failures are logged with the demand id and
   the HTTP status only — never the address or the request.
5. **"It's available now."** Owner-only command:
   `pnpm --filter @turbineh/db notify-available <ids…> | --capability <text> [--message <text>] [--send]`. It matches
   pending rows by id, by use case id, or by text in a missing requirement; without `--send` it is a dry run. With
   `--send` it sends one email per address listing that person's matching requests, marks the rows
   `available_notified_at` (claimed first; cleared if the send fails) and closes the person's `priority_notifications`
   subscription (`notified_at`) once none of their rows is pending. `pnpm --filter @turbineh/db demand` shows `#id`,
   "confirmed by email" and "told available".
6. **Environments.** `RESEND_API_KEY` and `EMAIL_FROM` are set (encrypted, production + preview) on the Vercel projects
   `code-frontiers-web` (production) and `code-frontiers-web-staging` (staging); `infra/staging/web.ts env` pushes them
   from `.env.local` (`RESEND_API_KEY`, with an optional `STG_RESEND_API_KEY` override for staging; `EMAIL_FROM` and
   `DEMAND_ALERT_EMAIL` optional). The worker hosts' `/etc/turbineh/*.env` do not need the key: the web sends.

## Consequences

- Staging sends real email too (same domain and sender); its links point to the staging URL through `BETTER_AUTH_URL`.
- Every refused request now emails the owner. If the volume grows, a daily digest can replace per-request alerts.
- Requests made with an API key and no account email get no confirmation (the owner alert still lists them).
- Tests: `packages/shared/src/email.test.ts` (Resend call over a mocked `fetch`, failures returned not thrown, the
  single warning, escaping), `packages/db/src/demand-email.test.ts` (content and escaping, once per row, retries and
  give-up, logs without personal data, available notices per address, the real SQL against Postgres with
  `TEST_DATABASE_URL`, including two concurrent senders), `apps/web/src/server/demand-email.test.ts` (scheduled with
  `after()`, only for refused flows, nothing without the key).

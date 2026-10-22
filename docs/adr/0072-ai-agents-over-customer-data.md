# ADR-0072 · AI agents over the customer's own data: mailbox triage, catalogue recommendations, booking agents

- Status: accepted (number reserved for this change; 0069–0074 belong to parallel work)
- Date: 2026-10-21
- Context: production demand since 2026-10-13 (analysed offline; requests paraphrased here, never quoted). Three kinds
  of AI agent the catalogue did not prove: (1) agents that read a person's mailbox, classify and prioritise every email,
  email a daily summary of what matters and record invoices and payments in a personal-finance spreadsheet (income,
  expenses, investments) — built twice on the ai-agents template with **0 of 4–5 requirements met**; (2) a
  conversational assistant for new-build homes that captures budget, location and needs, recommends matching homes
  from verified data, answers questions, compares options and books viewings — **refused** at "0 % functional
  coverage"; (3) the AI booking agent for a clinic that our own web shows as an example — planned at **1 of 5**
  requirements with a proving test. Owner rules: only verified functions are built (ADR-0052, ADR-0063); every AI call
  goes through the TurbineH orchestrator with its AI Safety Pack (ADR-0028); nothing offered for its own sake (ADR-0062).

## Decision

### 1 · `email.inbox.imapflow` — read one mailbox, read-only, incrementally

Native component built on imapflow 2.2.6 and mailparser 3.9.31 (MIT; pinned exactly, published more than 14 days ago,
added with exceljs 4.4.0 and @types/mailparser 3.4.6 to the **ai-agents template lockfile**, the only recipe that hosts
these AI domains — native components ship no dependency of their own). Three transitive packages newer than 14 days
were pinned to earlier releases with `pnpm.overrides` (`socks>ip-address` 10.7.3, `pino>process-warning` 5.1.0,
`chainsaw>traverse` 0.3.9). Credentials only from the environment (`MAIL_IMAP_*`: app password, or an OAuth 2.0 access
token over SASL XOAUTH2); TLS required unless the server is on the same machine; read-only by construction (EXAMINE +
BODY.PEEK, no write path); incremental by UID with UIDVALIDITY handling (the `n:*` rule handled; messages and position
saved in one transaction; the first run imports only the latest `MAIL_IMAP_MAX_PER_SYNC`); attachments kept as
metadata only. Contract tests run imapflow against a local IMAP4rev1 server (`tests/e2e/mocks/imap/server.ts`) that
also serves the E2E mailbox (`MAIL_IMAP_MOCK`, started by `playwright.config.ts`).

### 2 · `ai.mail-triage.turbineh` — triage, digest, finance ledger, Excel

Each new email goes once through `orchestrate()`: the task is written by the app, the email is a **document** (data;
injection attempts neutralised and flagged by the AI Safety Pack), the answer validates against a schema (category
from a closed list, priority, reason, optional finance block). Code re-checks amount, ISO 4217 currency and date before
an entry reaches the ledger. Owner-only pages (verified ADMIN_EMAILS): the inbox most urgent first with filters and
"Mark handled"; finances with totals per type and currency computed in cents, type correction, and an Excel export
(exceljs, Entries + Totals sheets). `jobs.scheduled.turbineh` runs `mail-sync` and the daily `mail-digest` (the
detector writes their schedule from the request; `files-with/jobs.scheduled.turbineh` makes each job sync, triage and
email the digest). The mock model gained `structured` script answers (`tests/mock-llm`), so E2E tests drive
orchestrate() with schema output offline.

### 3 · `ai.recommendations.turbineh` — recommendations over the customer's verified catalogue

A generic catalogue (`recommendation_items`: reference, price, location, attributes from params, `verified`) managed by
staff; a public toolkit for the assistant: `save_preferences` (validated, stored per conversation, visible to staff as
leads), `recommend_items` (filtering and ranking by code over verified rows only — never an invented record),
`item_details`, `compare_items` (chat + `/compare` page) and, with `domain.bookings.turbineh`, `book_viewing`
(irreversible: checked against real availability, confirmed by the person, linked to the record). The bookings
detector names the booked service from the request ("viewing", "visit", "tour").

### 4 · Booking agents

`bookings.assistant-books` absorbs the agent wordings its tests prove (query availability, re-check before booking,
create the booking); a new canonical criterion and E2E test prove that a taken time is refused with the free times of
that day suggested (`bookings.assistant-taken`). The AI Safety Pack no longer redacts dates and times
("2026-10-26 09:00") as phone numbers (`redactPii`, unit-tested), which broke booking dates sent to the model.

### 5 · Gate, canonical criteria and offers

- Domain detection (`packages/compiler/src/domains-mail.ts`, `domains-recommendations.ts`), ai-agents only, by code.
- `canonicalForPlan` adds what the selected components declare in `relations.requires`, transitively (the mailbox
  triage brings the mailbox reader and the scheduled jobs), and plan-time test lookup includes `files-with/<other>/`
  when `<other>` is in the app. `gateDomains` (ADR-0069) is reused unchanged.
- Canonical criteria (ADR-0063) for all three components, each linked to unit and E2E tests; `OFFER_HINTS`
  (ADR-0062) for mailbox triage, mailbox reading and recommendations, so an uncovered request that asks for them gets
  the verified component (with what it requires) and its proving test.
- `DOMAIN_PROBES` for both new domains: CI assembles and checks `ai-agents+ai.mail-triage.turbineh` and
  `ai-agents+ai.recommendations.turbineh`.

## Consequences

- Offline replica of the target builds (saved compiled specs, worker logic, code-only gate): the mailbox requests go
  from uncovered 0/5 and 0/4 to covered with every criterion linked to a test; the homes assistant from uncovered 0/7
  to covered; the clinic booking agent from 1/5 to all criteria linked. See the PR for the table.
- ai-agents apps carry imapflow, mailparser and exceljs in their lockfile even when the mailbox module is not used.
- Not proven: live Gmail / Microsoft 365 accounts (no credentials may be used; the IMAP server is local), the quality
  of a real model's triage (E2E uses a scripted model). Not covered: replying to or moving emails, reading attachment
  contents, bank/accounting integrations, several mailboxes, OAuth token refresh, semantic ranking.
- Tests: component unit/contract and E2E suites; `apps/worker/src/gate-agents.test.ts` (synthetic fixtures through the
  worker gate, offers); `packages/compiler/src/domains-{mail,recommendations}.test.ts`.

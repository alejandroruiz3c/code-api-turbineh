# ADR-0070 · Appointment reminders, SMS and WhatsApp as verified components

- Status: accepted
- Date: 2026-10-21
- Context: production demand (2026-10-13 → 2026-10-21). Three booking requests asked for reminders: one "with reminders"
  was built with 0 criteria met, one with "a WhatsApp reminder 24 hours before each appointment" was built without it
  (removed from scope: "no verified component connects to WhatsApp"), one with "an SMS reminder 24h before" was refused.
  The booking domain said "does not send reminders"; the gate listed SMS and WhatsApp as platforms no component
  connects to; `request_words` treated remind/SMS/WhatsApp as capability words. Owner rules: only real, tested
  functions are offered or claimed; official APIs only; logged mode without credentials; consent first.

## Decision

### 1 · Three components

| Component                   | Provides             | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messaging.sms.twilio`      | `messaging.sms`      | Twilio Programmable Messaging over its REST API with `fetch` (no SDK): `POST /2010-04-01/Accounts/{AccountSid}/Messages.json`, HTTP Basic auth, form body (To, From or MessagingServiceSid, Body, StatusCallback). E.164 with libphonenumber-js (`data.phone.libphonenumber-js`). Consent per number; STOP/START replies (Twilio's default keywords, `OptOutType`) and error 21610 opt out; a form tick never overrides a STOP. 429/5xx/unreachable retried with exponential backoff and jitter honouring Retry-After; an answer that never arrived is `unknown`, never re-sent (no idempotency key in the API). Webhook with `X-Twilio-Signature` over the public URL. Logged mode without credentials. |
| `messaging.whatsapp.meta`   | `messaging.whatsapp` | WhatsApp Business Cloud API `POST /v26.0/{phone-number-id}/messages`, approved message templates only (the only messages allowed outside the 24-hour window). Opt-in per number, STOP/START messages. Throughput errors (130429, 131056, 80007…) and 5xx retried; 132001/132000/131026/190 not. Webhook: verification (`hub.verify_token`) and statuses/messages checked with `X-Hub-Signature-256`. Logged mode.                                                                                                                                                                                                                                                                                        |
| `domain.reminders.turbineh` | `domain.reminders`   | Each confirmed appointment gets a reminder N real hours before it (params, default 24) per channel (email, SMS, WhatsApp), claimed under a unique key (appointment, channel, start time) before sending: once, whatever calls the route; never for cancelled appointments (pending retries dropped), again for moved ones, none for appointments booked after their reminder time; the business's local time in every text (DST-correct); SMS/WhatsApp only to people who ticked that box on the booking form; retries on later calls with backoff, interrupted attempts `unknown`; staff page.                                                                                                          |

`domain.reminders` requires `domain.bookings` and `jobs.scheduled`. `jobs.scheduled` gains **tasks**
(`src/jobs/tasks.ts`): work a component hands to the cron route, run on every call and idempotent by its own records
(`?task=<id>`); its params may now hold no job of its own. `domain.bookings` gains a form extension point
(`src/bookings/extensions.ts`, `form-extras.tsx`): extra fields, a check before booking, an action after it — the
reminder consent boxes replace both through `files-with/domain.bookings.turbineh/`. Channels are `null` files in
`src/reminders/channels/` replaced by `files-with/messaging.*` when the messaging component is in the app; the app
refuses to start if params name a channel whose component is missing.

`libphonenumber-js@1.13.14` (MIT, published 2026-09-24, the version the catalogue approved) is pinned in the saas-crud
and ai-agents templates (lockfiles refreshed with `--lockfile-only --ignore-scripts`): native components cannot add
dependencies to a frozen lockfile. New catalogue category `messaging`.

### 2 · Proof

- Contract tests against offline mocks recorded from each provider's documentation (2026-10) — they refuse what the
  real endpoints refuse and post signed callbacks — run as unit tests in the app; the same mocks serve the E2E run
  (`tests/e2e/mocks/TWILIO_API_BASE.ts`, `WHATSAPP_API_BASE.ts`; `playwright.config.ts` generates throwaway
  credentials).
- E2E in the bookings template: email reminder once with the local time; cancelled appointment not reminded; staff
  page; SMS consent box (refused without a reachable number), Twilio request, signed delivery update, STOP, no consent,
  retry then sent, dropped retry after cancellation; WhatsApp template with its parameters, webhook verification,
  signed statuses, STOP.
- `verify:recipe bookings+domain.bookings.turbineh+domain.reminders.turbineh+messaging.sms.twilio+messaging.whatsapp.meta`
  (a `COMPONENT_COMBINATIONS` entry) passes the full gate.

**Not proven:** the live services. No real Twilio or Meta credentials were used; templates must be approved by Meta and
US SMS needs A2P 10DLC registration — the customer's steps, listed in the guides.

### 3 · Criteria, plan and gate

- Canonical criteria (`criteria.yaml`): reminders by email, SMS (`when: messaging.sms`), WhatsApp
  (`when: messaging.whatsapp`), STOP per channel, no consent, cancelled, staff page; each messaging component's send,
  consent, retry, logged/webhook and phone criteria. A messaging component's "send" criterion never claims a requirement
  with timing ("before", "reminder"): that is the reminders' function.
- `canonicalForPlan` also reads `files-with/<other>` of the components in the set; `packageConditions` reports
  `messaging.sms` / `messaging.whatsapp` when the channel ships.
- Patterns `reminders`, `messaging.sms`, `messaging.whatsapp` (`detectReminders`, `detectMessaging`,
  `messagingPatterns` in the compiler): hours and channels as stated (24 h and email otherwise, as assumptions), the
  default country from the booking time zone. `gateDomains` (ADR-0069) now includes the components the request selects
  this way, so canonical wording and the gate's proven requirements see them; the fidelity wiring selects the same
  components at assembly. The reminder task needs `jobs.scheduled`: required with no job of its own.
- `request_words` still leaves remind/SMS/WhatsApp out of the request's subject words: they are absorbed only by the
  canonical criteria that declare them in `terms` (the reminder criteria). Removing them would let "books a slot and
  gets an SMS confirmation" map to the public booking criterion; a regression test keeps it out.
- Scope gate (minimal change in `uncoveredByCode`): SMS and WhatsApp are covered when a verified component sends on
  them, except conversations or bots on those channels ("Integration with WhatsApp conversations: …").
- Offers: hints for SMS and WhatsApp (ADR-0062); the labelled set's WhatsApp-reminders case now accepts
  `messaging.whatsapp.meta` (the request has no booking app, so the reminders themselves are not acceptable).

## Consequences

- Offline replay of the three production requests (stored compiled specs, code only): "with reminders" goes from
  refused to covered with the email reminder proven; the WhatsApp reminder request from partial to covered with the
  reminder proven; the SMS + card payment + native app request from refused to partial (card payment judged by the
  decision engine until ADR-0071's canonical criterion lands; the native app stays out).
- Every app gets libphonenumber-js in its lockfile (unused unless a messaging component ships).
- Limits: outbound notifications only (no conversations, MMS, media templates or marketing); one reminder per
  appointment and channel; precision is the scheduler's interval; mocks, not live services.

# ADR-0074 · Contact email for invitation workspaces and "notify me when it's covered"

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-21
- Amends: ADR-0052 §4 (who is subscribed to the priority notice), ADR-0056 §2 (whose email the confirmation uses)
- Context: almost everyone enters the product with the shared invitation token (`/access`, ADR-0030), so their flows
  run in an anonymous `invite:<uuid>` workspace. The contact email of a flow was only set for signed-in GitHub
  sessions, so the demand recorded for requests the library does not cover had no email at all, and nobody could be
  told when their request became available — the promise of ADR-0052 ("we'll notify you with priority") could not be
  kept. The owner decided to record the email from now on.

## Decision

1. **The access page asks for the email.** `/access` has a required, validated email field next to the token, with
   one line on what it is for ("only to tell you when something you asked for that the library doesn't cover yet
   becomes available; only TurbineH staff see it; it is never shared"). `POST /api/access` checks the token first,
   then the email (an invalid one redirects back with `?error=email`; neither the token nor the email ever goes in the
   URL), sets the workspace cookie and stores the address in the new table `workspace_contacts(owner_id PK, email,
created_at, updated_at, changes, window_start)` (migration `0017_workspace_contacts.sql`). A storage failure is
   logged and never blocks entry: the app asks again.
2. **Workspaces that entered before are asked once per visit.** A banner (`ContactBanner`, in the root layout, not on
   `/access`, `/use` or `/ops`) asks a workspace without an email for one; "Later" hides it until the browser session
   ends. It reads `GET /v1/contact` (masked: `p•••@example.com`) and saves with `PUT /v1/contact {email}`;
   `DELETE /v1/contact` forgets it.
3. **Every new plan and build carries the contact email.** `POST /v1/plans` and `POST /v1/builds` accept an optional
   `notify_email`; the flow's `contact_email` is that, else the signed-in account's email, else the workspace's. It
   still cannot be injected through `options`. The worker's `recordDemand` falls back to the workspace's email when the
   flow has none, so the demand row and the priority subscription have it.
4. **Saving an email reaches earlier demand.** Setting (or changing) a workspace's email fills it on that workspace's
   earlier demand rows and subscription that had none (or had the previous workspace email); an explicit
   `notify_email` on a row is never overwritten. No email is sent for those rows by this.
5. **"Notify me when it's covered."** On the not-covered screen (`NotCovered` with the flow id: refused flow, plan
   screen with a components-only offer, the wizard's refusal), when the flow's demand has no email, a field saves one
   with `POST /v1/builds/{id}/notify {email}` (`GET` answers `{demand, email_on_file, confirmed}`, never the address).
   It goes on the demand row (and on the subscription of a private workspace); if the priority-list confirmation of
   ADR-0056 was not sent yet, its attempts are reset and it is sent once after the response, regardless of the 2-day
   window (the person just asked for it). 409 `not_uncovered` when the flow was not refused.
6. **CLI and MCP.** `turbineh build|plan --notify-email <address>` (or `TURBINEH_NOTIFY_EMAIL`) sends `notify_email`;
   `turbineh notify [id] <email>` calls the notify endpoint (default id: the project's last flow). The MCP `build` and
   `plan` tools take `notifyEmail`, and a new `notify` tool `{id?, email}`; the agent instructions say to use only an
   address the user gave.
7. **Shared workspaces never hold an email.** The invitation token's `api-default` workspace and any guessable
   `x-turbineh-workspace` are used by several people: an email stored there would be used for someone else's request
   (and the confirmation quotes the request). They cannot set a workspace email (`PUT /v1/contact` → 403
   `shared_workspace`), and their priority subscription never takes an email; a per-request `notify_email` stays on
   that request's row only. The rule (`isPrivateOwner`) is the same one that already guards GitHub connections.
8. **Privacy and limits.** Addresses are trimmed, lower-cased and validated (`isEmailAddress`); the API returns only the
   caller's own address, masked; another owner's flow is a 404. A workspace email can change at most 10 times a day;
   the email of one refused flow at most 5 times; a confirmation is still sent at most once per demand row and only for
   the caller's own refused flows, so the number of emails stays bounded by the existing build quotas. Staff see the
   address in the owner report (new identity source `workspace`) and the demand list, as before.

## Consequences

- From this release, every new invitation workspace has an email, and the 29 earlier demand rows without one get it if
  their workspace answers the banner (the browser's workspace cookie is what links them).
- The owner can tell people their request is covered with the existing `notify-available` command (ADR-0056 §5).
- Migration `0017` must run before the web and worker of this release (the worker's demand insert reads
  `workspace_contacts`).
- No browser-automation harness exists for the product web app; the "E2E" tests drive the real route handlers and the
  real SQL with a simulated browser (cookies, headers) and email provider:
  `apps/web/src/server/contact-flow.e2e.test.ts` (Postgres, `TEST_DATABASE_URL`), `contact-routes.test.ts` (no
  database), `components/contact-email.test.tsx` (the access page and the notify field), `packages/db/src/contacts.test.ts`
  (SQL: backfill, shared workspaces, limits, the confirmation once), `packages/cli/src/notify.test.ts` and the MCP
  `notify` tool in `mcp.test.ts`.

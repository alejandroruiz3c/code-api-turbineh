# ADR-0054 · Generated-app security hardening: secrets, roles, state, tenancy, limits, time, audit and repairs

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-15
- Context: an external audit of an app generated with the `saas-crud` recipe found defects that come from the generator,
  the compiler, the recipe template and catalog components, so every generated app had them. The fixes below are made
  at the source and are catalogue-wide standards: every recipe (all extend `saas-crud`) and every component that
  shares the pattern follows them.

| Finding | Severity | Cause (before)                                                                                                                                                                         |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | critical | `entities.ts` generated CRUD, list cells and CSV columns for every field: `accessToken` was a plain-text column, a form field, a table cell and a required CSV header in the E2E test. |
| F02     | critical | `mapToOrgRoles`: a single named role was mapped to owner, admin **and** member, so invited members got every privilege and the label "Admin".                                          |
| F03     | high     | `toRole(undefined)` → `member`, and `getActiveMember().catch(() => null)`: a failed lookup or an unknown role became a member.                                                         |
| F17     | critical | Permission tests compared `can()` with the same `ROLE_MATRIX` it reads (tautology); a repair could edit tests freely.                                                                  |
| F06     | critical | Rules from the request vanished: the rules stub said "none were requested", rules not chosen for T3 were nowhere. Status fields were editable in forms.                                |
| F10     | high     | Relations were free `varchar` values without foreign keys; a free `workspaceId` field sat next to `organizationId`.                                                                    |
| F11     | medium   | Zod allowed 255 characters where the column held 64; quotas could be negative; enums had no database check.                                                                            |
| F12     | medium   | `datetime-local` values were stored without a time zone.                                                                                                                               |
| F14     | high     | A mutation and its `audit()` entry were separate writes.                                                                                                                               |
| F15     | medium   | CSV exports were silently cut at 10,000 rows.                                                                                                                                          |
| F16     | high     | Without `RESEND_API_KEY` in production, verification links were logged to the console.                                                                                                 |
| F21     | high     | In-memory, single-instance rate limit; client IP taken from a spoofable `X-Forwarded-For`.                                                                                             |

## Decision

### F01 · Secrets are never CRUD

`@turbineh/compiler` owns one classifier (`fidelity/field-policy.ts`): `sensitiveField(name)` flags tokens, secrets,
passwords, API keys, refresh tokens, credentials, private keys, card numbers and security codes in any naming style
(counters such as `tokensUsed` or `maxTokens` are not secrets). The assembler's `fieldsOf()` drops them, so they never
become a column, a form field, a list cell, a CSV column, a prop or a log value. Each dropped field is reported with a
stable id (`SEC-<ENTITY>-<FIELD>`) as **not covered** — in the package README ("Not covered by this build") and in
AGENTS.md's "what is left": storing third-party credentials needs encryption at rest with a write-only input, which no
generated CRUD does. Passwords are not listed (sign-in already handles them). The template ships a fixed invariant test
(`tests/unit/data-safety.test.ts`) that fails if a generated table, form schema or export ever holds a secret-shaped
name. The audit-log component redacts the same words (`apikey`, `credential`, `private_key`… added).

### F02 · Members never inherit an admin-like role; deny by default

- `mapToOrgRoles`: a single high-ranked role (owner, admin, manager, editor, staff) is the owner and admin; a single
  low-ranked role (member, viewer, client) is the member. When no role of the request maps to the invited member, a
  default **Member** role is added with `read` and `create` only (and an assumption says so); when none maps to owner,
  a full-rights **Owner** is added. The admin fallback is the owner's role, never the member's.
- The member default is `read`, `create` (export removed). `approve`, `export`, `configure`, `manage_members` and
  `view_audit` (`PRIVILEGED_ACTIONS`) reach a member only through a rule of the request that names that role.
- Template `permissions.ts`/`role-policy.ts`: approve, export and configure are privileges of their own (they no longer
  follow `update`/`read`). Export routes of recipes and components (analytics, AI processes, analytics import) check
  `can(role, "export")`. The membership component denies these three to every non-owner role unless the matrix grants
  them.

### F03 · Unknown means denied

`toRole()` returns `null` for a missing or unknown role (template, generated `role-policy.ts`, membership component).
`requireMember()` throws on a failed membership lookup (never a guess), redirects non-members (a 4xx "not a member"
from the auth API) to create a workspace, and refuses an unknown stored role with a clear message.

### F17 · Fixed expectations and repairs that cannot weaken tests

- The generated `tests/unit/permissions.test.ts` writes the request's matrix out as literal expectations at assembly
  time (and the role labels), plus fixed negatives for the invited-member role ("a member cannot approve, export,
  change settings, manage members or read the audit log" for every privilege the request did not grant it). It never
  reads `ROLE_MATRIX` to decide what to expect. The template ships the same for its base policy;
  `tests/unit/access.test.ts` holds the invariants of every app (unknown roles can do nothing, unknown stored roles are
  refused, failed lookups throw, untrusted proxies are ignored).
- **Repair rule (deterministic):** `@turbineh/verifier` `revertWeakenedTests()` runs in every repair loop — directed
  corrections and Backup Coder T4 patches (`integrator/corrector.ts`) and repairs after a security remediation
  (`remediation/remediate.ts`, which also refuses a security fix that weakens a test). A change that deletes a test
  file, removes or renames a test, removes an assertion, adds `skip`/`only`/`todo`, or changes any assertion line of a
  fixed oracle (permissions, access, authz, data-safety, security, env, spec-constraints, rule fixtures, component
  contract tests) is restored from HEAD before it can be committed. The generated permission and constraint tests are
  also never offered to a model for correction.

### F06 · Rules are code, a listed limitation or a blocked item; state is never typed

- Every rule candidate of the request that is not code (T3), not covered by the recipe and not covered by the generated
  form is listed in TURBINEH_REPORT.md under "Business rules" with an id (`R1`, `R2`…): ⚠️ **limitation** (not chosen,
  with the reason) or ⛔ **blocked** (chosen but not written, or written and removed because it could not pass). The
  rules stub no longer claims "none were requested"; it points to that ledger. (`rulesWithoutCode` in the worker,
  `rulesNotImplemented` in the report facts.)
- State fields (`status`, `approvalStatus`, `stage`, `workflowState`, and lifecycle stamps such as `publishedAt`,
  `approvedBy`, `isPaid`) are not inputs: not in create/edit forms, schemas or CSV imports. A new record starts at the
  first listed value (database default). The values come from the field or, when the model gave none, from the status
  list the request states ("statuses (pending, received, approved)"). Each status or stage gets a role-gated server
  action (`change<Entity><Field>`) — `approve` for approval-like values, `update` otherwise; a select of the listed
  values, or a bounded text when the request lists none — that locks the row, stamps the matching lifecycle fields
  (`approvedAt`/`approvedBy` when the status becomes "Approved") and writes its audit entry and history in the same
  transaction. Configuration (settings) entities keep their fields as inputs. Limitation: business
  rules run on create/edit, not on transitions; child lists start at the first value and have no transition form.

### F10 · Tenant-scoped references, no editable tenant ids

- Tenant ids (`workspaceId`, `tenantId`, `orgId`, `organization`…) are never generated fields: the server owns
  `organizationId`.
- A reference field to another generated entity keeps the value people type (the target's display field) and gets a
  server-set companion `<field>_record_id` (uuid): the server resolves the value in the same workspace and refuses names
  of no record; the table has a composite foreign key `(organization_id, <field>_record_id) → target(organization_id,
id)` (every generated table has `unique(organization_id, id)`), `ON DELETE RESTRICT` (deleting a referenced record
  says "still used by other records"). Child lists store their parent as a uuid with a tenant-scoped foreign key that
  deletes with the parent. E2E tests seed referenced records (two levels deep) before using them. Event histories stay
  without a foreign key (append-only rows may outlive their parent).

### F11 · One source of limits

`FIELD_LIMITS` (assembler `fields.ts`) drives the column length, the Zod `max()`, and the input's `maxLength`/`min`/`max`
(string 255, email 320, enum ≥ 64 and ≥ its longest value, reference 255, text 5,000, URL 2,048, numeric(12,2)).
Integers and decimals are non-negative (Zod `min(0)` and a database `check … >= 0`) unless their name says otherwise
(balance, delta, adjustment, offset, temperature, latitude…). Enums with listed values get a database check of the
allowed values.

### F12 · UTC plus IANA zone

Every typed date-and-time field gets `<field>_time_zone` (default `UTC`). The form sends the browser's zone
(`TimeZoneField`, `useSyncExternalStore`, server/no-JS fallback `UTC`); the schema keeps the local
`YYYY-MM-DDTHH:mm` string and `to<Entity>Values()` stores `zonedToUtc(local, zone)` (template `src/lib/datetime.ts`, no
dependency). Lists show `formatDateTime(value, zone)`, edit forms show the value in the zone it was typed in, exports
include the zone column.

### F14 · One transaction

The template `audit(entry, executor?)` and the audit-log component take the transaction (`Executor` = `db` or a
transaction, `src/db/client.ts`). Every generated mutation (create, update, transition, delete, CSV import, settings
upsert, child add/remove) writes the change, its audit entry and its history entry inside one `db.transaction`. The
workflow, membership, private-uploads and analytics-import components do the same.

### F15 · Exports never silently truncated

`EXPORT_MAX_ROWS` (50,000) and `exportTooLarge()` in `src/lib/csv.ts`: generated exports, the audit log, the waitlist,
analytics and AI-process exports read one row more than the limit and answer `413` with "narrow the filters" instead
of a cut file.

### F16 · Email in production

`src/env.ts` (all recipes) refuses to start in production without `RESEND_API_KEY`, unless `EMAIL_DELIVERY=disabled`
says on purpose that the app runs without email, or a test run records emails in `EMAIL_OUTBOX_FILE`;
`src/instrumentation.ts` validates at server start. `sendEmail()` never writes a link, a body or a recipient to the
console; without a provider, development writes `.turbineh/email-outbox.jsonl` (git-ignored) and tests their outbox
file. Deploy-for-me sets `EMAIL_DELIVERY=disabled` until the client adds Resend; DEPLOY.md says what that means (no
verification or invitation emails; invitation links stay visible to the inviter in the app).

### F21 · Shared rate limit, trusted proxies

`rateLimit()` is async and backed by the app's PostgreSQL (`rate_limits`, `src/db/component-security.ts`): one atomic
upsert per hit, windows reset in the database, expired rows deleted (TTL). Unit tests and `RATE_LIMIT_STORE=memory` use
an in-process store. ESLint (`no-restricted-syntax`) and a unit test refuse an un-awaited call. `clientIp()`
(`src/security/client-ip.ts`) trusts `X-Forwarded-For` only through `TRUSTED_PROXY_HOPS` proxies (default 1 on Vercel,
otherwise 0), counted from the right, so a client cannot pick its own bucket; the storefront and the AI assistant use
it too.

## Consequences

- Invited members of single-role requests now get read/create only; owners promote people to admin for more. Learning
  fixtures (corporate-site, bookings, tracker, landing-waitlist) were updated to this rule.
- Apps deployed without an email provider no longer expose verification links in logs, so staff verification
  (ADMIN_EMAILS) needs Resend.
- Business rules do not run on status transitions (role permissions do); transitions on child lists are not generated.
- Display names of referenced records are copied at write time (the record id is the source of truth for integrity).

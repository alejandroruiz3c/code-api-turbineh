# ADR-0040 · Domain components for common business patterns

- Status: accepted (first part)
- Date: 2026-10-13
- Context: learning round (`bench/frontiers/ANALYSIS.md` §12 on `wip/frontiers-bench`, G1). In 9 runs the coding
  agent kept our foundation and rewrote the domain (400–1,400 lines each): status workflows with role-gated
  transitions, invitations with roles, per-record access, audit log, private uploads, scheduled jobs, public pages,
  waitlist mechanics, analytics import and the bookings domain were missing.

## Decision

1. **Reusable domain components, parameterised by the spec.** Each one follows the ADR-0033 pattern (`files/`,
   `params.json` written by the assembler, `acceptance.yaml`, `guide.yaml`) and declares its parameters in
   `component.yaml` (`params: { file, schema, entities }`) with a JSON Schema (`params.schema.json`). The compiler
   (branch `feat/spec-fidelity`) generates params against that schema; `catalog:validate` checks that the schema compiles
   and that the shipped default satisfies it; `guide.yaml` documents each field (`params` section, rendered into
   `docs/components/<id>.md`).
2. **Three seams in the base template**, no-ops by default, replaced in place by components:
   - `src/server/role-policy.ts` — `can(role, action)`, `toRole`, roles; `domain.membership-access` replaces it with
     the request's roles (owner/editor/viewer, manager/member, staff/client).
   - `src/server/record-access.ts` — `visibleScopes`, `canSeeScope`, `scopeOptions`; per-record scopes (company,
     project, shop) shared by every component that stores scoped records.
   - `src/lib/audit.ts` — `audit(entry)`; generated entities and domain components call it; `domain.audit-log`
     replaces it with an append-only log.
3. **Database rules drizzle-kit cannot express** (append-only triggers) ship as `src/db/sql/*.sql`, applied
   idempotently by `scripts/migrate.ts` after the tables exist. History and audit tables are append-only in code and in
   the database.
4. **`requireSession(): Promise<{ userId, email }>`** in `src/server/authz.ts` for actions of signed-in people who are
   not members yet (accepting an invitation) — the exact name and shape used by `feat/agent-closing-loop`. Sign-in and
   sign-up honour a same-site `next` path (`src/lib/safe-next.ts`); an invitee signs up without creating a workspace.
5. **Assembler adapters:** `files-recipe/<recipe>/` (copied when that recipe is in the chain) and
   `files-with/<component>/` (copied when that other component is selected), after every component's `files/`.
   Component extension points are listed in AGENTS.md.
6. **Combinations are checked assembled** (`COMPONENT_COMBINATIONS` in `apps/worker/src/combinations.ts`), each with the
   request it comes from and the params a compiler would write; `verify:recipe <recipe+component+…>` runs one.

## Components in this change

`domain.audit-log.turbineh`, `domain.membership-access.turbineh`, `domain.workflow.turbineh`. Pending (next PR):
`storage.private-uploads`, bookings recipe on `domain.bookings`, `jobs.scheduled`, `site.public-pages`,
`growth.waitlist`, `data.analytics-import`, `ui.kanban`.

## Consequences

- An app gets roles, invitations, scopes, an audit trail and workflows from data, with E2E tests whose titles state the
  criteria; agents extend them through documented seams instead of rewriting.
- When `domain.membership-access` replaces the role policy it also replaces `tests/unit/authz.test.ts` (param-generic);
  the base rule pointing at the old title stays open in such apps.
- E2E of these components retries sign-in/sign-up after better-auth's 3-per-10-s production limit instead of changing
  the limit.

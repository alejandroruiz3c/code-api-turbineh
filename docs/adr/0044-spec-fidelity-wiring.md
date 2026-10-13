# ADR-0044 · Spec fidelity wired into builds: generation by kind, role matrix, constraints, pattern components

- Status: accepted
- Date: 2026-10-13
- Context: ADR-0042 modelled the request (entity kinds, roles and rules, constraints, domain patterns) but nothing
  used it: generated packages still had CRUD pages for tags, joins, events, limits and logs, the template's
  owner/admin/member policy, UTC and a fixed page size, so coding agents rewrote the domain (learning round,
  `bench/frontiers/ANALYSIS.md` §12). Owner priority: zero extra work for agents; everything generic.

## Decision

1. **Pipeline.** After compiling, `wireFidelity` (apps/worker) runs `specFidelity` (decider only for unsure entity
   kinds, ADR-0039), folds tags into their parent, sets status options and adds capabilities the request implies by
   code ("export … CSV" → `data.csv-export`). Its pattern selections join the legacy domain detector's.
2. **Pattern components by code** (`wirePatterns`, compiler). For each detected pattern: an **approved** component that
   provides one of its capabilities (or is named after it), **declared for the recipe** (use cases / guide
   compatibility), whose params — built by an adapter (workflow, membership-access, audit-log), else the pattern's own
   params, else those over the component's shipped defaults — **validate against its `params.schema.json`**. Params go to
   `params.file`; `params.entities` are not generated again. A component added to the catalog (e.g. on
   `feat/domain-components-2`) is picked up with no code change. Anything else is **missing**: its criteria stay open
   and AGENTS.md lists it under "What is left" with where and how (`PATTERN_GUIDE`).
3. **Generation by kind** (`packages/assembler/src/kinds.ts`): business → CRUD (status field replaced by a
   `domain.workflow` item when the workflow is selected: created with the record, state column, link to its history);
   configuration → settings page (`/dashboard/settings/<slug>`, `configure` permission, no delete); event → table,
   append-only writer and database trigger, timeline on the parent's edit page, written on every change of the tracked
   field; child and join → section of the parent's edit page; log → table and writer, no UI unless asked; membership
   and tags → nothing of their own. A child or event of a recipe entity is generated and listed as left with where to
   mount it. Per-record scope (membership-access with a scope): the reference to the scope entity becomes a scope
   picker, lists filter by `visibleScopes`, records are checked with `canSeeScope`.
4. **Roles and rules → authz.** New base seam `src/server/permissions.ts` (`ROLE_MATRIX`, `RESOURCE_RULES`,
   `SIGN_UP_EMAIL_DOMAINS`, `allows`); `authz.can(role, action, resource?)` asks it; the base `role-policy.ts` reads it.
   The assembler generates it from the request: stored roles owner/admin/member with the request's labels and rights,
   or — when `domain.membership-access` is selected — the request's own keys (top role stored as `owner`), with its
   params generated from the same matrix (core actions delegated to the component's policy; approve/export/configure
   from the matrix). Sign-up domains are enforced in `maySignUp` (staff always allowed). Generated actions pass their
   resource; the CSV export checks `export`. Per app: `tests/unit/permissions.test.ts` (the whole matrix plus one test
   per rule: read-only roles, who approves/exports/manages members/sees the audit log, per-resource rules, scopes,
   sign-up domains) and `tests/e2e/sign-up-domains.spec.ts` when domains are restricted.
5. **Constraints.** New base seam `src/lib/spec-constraints.ts`; the assembler writes the request's time zone,
   currency, uploads, notice, opening hours, statuses, sort, schedules, email domains, numbers and page size, with the
   defaults used listed; pagination reads its page size, timelines format in its time zone, status lists become enum
   options, sort orders the list default. Unit test per app.
6. **Criteria.** On top of ADR-0043 (G3: every rule carries the shipped test's title and assertions, rules whose test
   file or title is not in the package are dropped — which also fixes `domain.bookings` rules pointing at `files-ai`
   tests in non-AI apps — and `proofVerdict` decides): the generated permission tests, the sign-up-domain E2E and the
   new generated E2E (filtered export, tag filter, sort, child sections, history) are coverage rules with their proof;
   E2E tests act as the workspace owner, whose label is the request's top role (Staff, Manager…), so the actor check
   sees that role. Unsure = open.
7. **`verify:spec <fixture>`** (apps/worker): compiles a learning spec offline (fixtures + deterministic paths, no
   model), assembles before (no fidelity) and after, runs the gate (`--quick` or full) and prints entities/pages,
   roles, patterns and criteria met/open. `--without <component>` exercises the generic fallbacks.

## Consequences

- Fieldnote, Kilnwise and Pixelyard assemble with only their business pages and pass the full gate (results in the
  PR).
- Not done: approval gating of a status field without the workflow component; mounting child sections on recipe
  pages; decider measurement on an ambiguous set; per-stage limits from a settings entity into workflow `limitHours`.
- Numbering: parallel branches also add ADRs; renumber at merge if 0044 is taken.

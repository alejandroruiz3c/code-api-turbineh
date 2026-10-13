# ADR-0042 · Spec fidelity: entity kinds, roles, constraints and domain patterns from the request

- Status: proposed (partial implementation, see "State")
- Date: 2026-10-13
- Context: learning round of 9 specs (`bench/frontiers/ANALYSIS.md` §12 on `wip/frontiers-bench`, G1 and G2). Coding
  agents deleted generated CRUD for join tables, event logs, config tables, email logs and memberships (note-tags,
  stage-events, stage-limits, email-logs, workspace-members), turned tags into fields, replaced the template roles with
  the spec's (editor/viewer, manager, staff/client), used UTC instead of the stated time zone and ignored stated
  limits. ADR-0039 rule applies: deterministic questions → code; choices code cannot settle → the decider, measured.

## Decision

### 1 · Entity kinds (`packages/compiler/src/fidelity/entity-kinds.ts`)

Every entity the compiler model lists is classified by code into **business** (CRUD or a workflow screen),
**relationship** (`tags` | `join` | `membership` | `child`: no page of its own, managed from the parent), **event**
(append-only, timeline on the parent), **configuration** (settings page) or **log** (no UI unless the request asks).
Rules use the name's head noun, the fields (references, from/to fields, user references) and the request's sentences
("Projects have phases", "messages … per request"). Tag entities and their joins fold into a `tags` field of the
parent (new field type `tags`, set by code only). Entities no rule settles are marked `unsure`; only those go to the
decider (one Choice each, one batched request), accepted at `ENTITY_KIND_CONFIDENCE` = 0.7, otherwise the code
default (business) stands. On the 9 specs the rules are conclusive for every entity: the decider is asked 0 times.

### 2 · Roles and permissions (`permissions.ts`)

Roles the request names (explicit lists first, then actors that sign in) are mapped by rank onto the three workspace
roles authentication stores (owner, admin, member), so sign-up, invitations and templates keep working. Rules come
from sentences with the role as actor: read-only ("viewers cannot edit"), approve/change status, export, invite,
create a resource, audit-log visibility, per-record scope ("only their own company", "projects they belong to") and
sign-up email domains. The result is a `PermissionMatrix` with `canDo(matrix, role, action, resource?)`, the
semantics the generated `can()` is meant to implement.

### 3 · Constraints (`constraints.ts`)

Time zone (IANA, then city, else UTC as a documented default), currency, upload size and types, privacy, durations
and prices, notice periods, opening hours, page size, sort orders, status lists, email domains, schedules (cron) and
stated numbers. Status lists become `options` of the matching enum field.

### 4 · Domain patterns (`patterns.ts`)

workflow, membership-access, audit-log, private-uploads, jobs.scheduled, site.public-pages, growth.waitlist,
data.analytics-import, kanban and bookings are detected with their params from §1–§3. `selectPatternComponents`
selects an **approved** catalog component that `provides` one of `PATTERN_CAPABILITIES[id]`; params go to the
`src/…/params.json` named in its contract inputs. A pattern without a component is reported as missing and its
criteria stay open. The component ids and params schemas of `feat/domain-components` were not published when this
was written: the params here are the contract proposed to that branch and must be reconciled with it.

### 5 · Criteria

A criterion is met only by a test shipped in the package (ADR-0039 §4 unchanged). The fidelity summary
(`bench/fidelity/summary.ts`) lists which pattern touches each criterion; nothing is reported met without assembly
and the gate.

## State (what this PR ships and what is left)

- Shipped: §1–§4 in the compiler with regression tests over the 9 specs (`learning-specs.fixtures.ts`: expected
  kinds, roles, rules, scopes, constraints and patterns per spec); the generator understands `tags` and enum
  `options` fields and has (unused by default) settings, event-timeline and child-section options; offline summary
  `bench/frontiers/fidelity-2026-10-13.md`.
- Wired by ADR-0043 (pipeline, assembler, criteria from shipped tests, `verify:spec`). Originally left: wiring into the worker pipeline and the assembler (generate by kind, `src/server/permissions.ts` + authz
  rewrite + per-spec unit tests, `src/lib/spec-constraints.ts`, pattern params), criteria → component E2E mapping
  filtered by shipped tests, decider measurement on a labelled ambiguous set, staging build with Brickline.

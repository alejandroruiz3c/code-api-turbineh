# ADR-0026 · T3 business rules on edits and across entities

- Status: accepted (owner request, 2026-10-12)
- Date: 2026-10-12
- Extends: ADR-0023 (T3 business rules) and its 2026-10-12 amendment, which excluded cross-entity rules up front.

## Context

T3 implemented rules only when records were created or imported, and only on the records of the same entity:
generated entities had no edit flow, and rules such as "a course can only be assigned to a teacher that exists" or
"a booking cannot exceed the room capacity" were left to the report as not verified.

## Decision

**Edits.** Every generated entity now has an edit flow: `update<Entity>` server action (role check `can(role,
"update")`, rate limit, `z.uuid()` id, read and write scoped to the active workspace), an edit page
`/dashboard/<entity>/<id>` (owners and admins; `notFound()` otherwise) and an E2E test that edits a record. The rules
hook receives `ctx.operation` (`"create" | "update"`), `ctx.previous` (the record before the change) and `ctx.existing()`
excludes the record being changed, so uniqueness and overlap checks never compare a record with itself.

**Cross-entity.** The hook context exposes `ctx.related.<entity>()`: typed, read-only loaders of other generated
entities of the same workspace (newest first, `RULES_SCAN_LIMIT`). They are written by code into
`src/entities/<entity>/related.ts` (the assembled default has none) and are never handed to a model: the corrector
cannot edit them, a dropped rule restores the stub.

- A rule reads another entity only when a **reference field** links them (deterministic: the field is named after the
  entity, e.g. `teacher`, `teacherId`). The reference holds the referenced record's display field (its first text
  field); end-to-end tests create the referenced record first, and the imported sample points to a second seeded
  record, so "one per person" rules accept the app's own fixtures.
- Rules that need users, team members, roles, external services, payments, schedules or jobs stay excluded.

**Decider.** Seven atomic questions per criterion in the same batch: rule, covered, needs-other-records, entity,
related entity (choice), when (`create` / `update` / `both`), complexity (rubric updated: other linked entities are
level 2). Fixed thresholds: related choice ≥ 0.5 (a confident "none" wins over the text), otherwise the entities named
in the rule text; at most 2 related entities per rule; operation choice ≥ 0.5, otherwise both. The per-build cap (3
rules) is unchanged.

**Backup Coder.** Context grows only by the schemas of the related entities the rules read and the code-written
loaders; instructions cover operations, `previous`, the loaders and reference matching. Its test must cover each rule
on each operation it applies to. The fixtures test written by code checks create, import next to create and the E2E
edit, with the related records the E2E test seeds.

**Report.** Each rule lists when it runs and what it reads, e.g. "(on create and edit, reads Teacher)".

## Consequences

- One more question pair per criterion (cost of the single decider batch grows; still one request).
- Apps get an edit page per entity even without rules (expected by users of CRUD apps anyway).
- Cross-entity rules without a reference field (free-text names) are still reported as not implemented.

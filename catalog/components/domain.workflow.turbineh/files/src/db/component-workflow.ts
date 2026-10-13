import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Workflow tables (component domain.workflow.turbineh): records that move through states (requests, loans, pieces,
 * tasks…) and their immutable history. History rows are never updated or deleted: no code path does it and the
 * database refuses it (src/db/sql/*workflow*.sql).
 */
export const workflowItems = pgTable(
  "workflow_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    /** Workflow key from src/workflow/params.json. */
    workflow: varchar("workflow", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    /** Optional id of the record this item follows (an entity row of the app). */
    subjectId: varchar("subject_id", { length: 64 }),
    /** Per-record access scope (company, project, shop) — see src/server/record-access.ts. */
    scopeId: uuid("scope_id"),
    state: varchar("state", { length: 40 }).notNull(),
    stateSince: timestamp("state_since", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdByEmail: varchar("created_by_email", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflow_items_org_state_idx").on(t.organizationId, t.workflow, t.state),
    uniqueIndex("workflow_items_subject_idx").on(t.organizationId, t.workflow, t.subjectId),
  ],
);

/** Immutable history: one row per state change (and the creation), with who and when. */
export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => workflowItems.id),
    fromState: varchar("from_state", { length: 40 }),
    toState: varchar("to_state", { length: 40 }).notNull(),
    actorId: varchar("actor_id", { length: 64 }).notNull(),
    actorEmail: varchar("actor_email", { length: 320 }),
    note: varchar("note", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_events_item_idx").on(t.itemId, t.createdAt)],
);

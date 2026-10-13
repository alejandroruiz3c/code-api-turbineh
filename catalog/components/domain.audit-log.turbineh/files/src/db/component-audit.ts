import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Append-only audit log (component domain.audit-log.turbineh): one row per change, per workspace. Rows are never
 * updated or deleted: the app has no code path that does it and the database refuses it (src/db/sql/*audit*.sql).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    actorId: varchar("actor_id", { length: 64 }),
    actorEmail: varchar("actor_email", { length: 320 }),
    action: varchar("action", { length: 80 }).notNull(),
    subjectType: varchar("subject_type", { length: 80 }).notNull(),
    subjectId: varchar("subject_id", { length: 64 }),
    summary: varchar("summary", { length: 500 }).notNull(),
    /** [{ field, before, after }] with sensitive fields redacted. */
    changes: jsonb("changes")
      .$type<{ field: string; before: string | null; after: string | null }[]>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_org_time_idx").on(t.organizationId, t.createdAt),
    index("audit_events_org_action_idx").on(t.organizationId, t.action),
    index("audit_events_subject_idx").on(t.organizationId, t.subjectType, t.subjectId),
  ],
);

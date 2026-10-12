import { index, integer, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** Audit of every AI call (component security.ai-safety.turbineh): metadata only, the content is a SHA-256 hash. */
export const aiAudit = pgTable(
  "ai_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    purpose: varchar("purpose", { length: 64 }).notNull(),
    route: varchar("route", { length: 32 }),
    decision: jsonb("decision"),
    inputChars: integer("input_chars").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    flags: varchar("flags", { length: 200 }).notNull().default(""),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_audit_org_idx").on(t.organizationId, t.createdAt)],
);

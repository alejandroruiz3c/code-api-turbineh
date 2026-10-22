import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Matching tables (component domain.matching.turbineh). Every row belongs to one organization (workspace) and every
 * query filters by the caller's active organization: profiles, the records that are matched (opportunities, tenders…)
 * and the organization's feedback on them.
 */
export const matchingProfiles = pgTable("matching_profiles", {
  organizationId: varchar("organization_id", { length: 64 }).primaryKey(),
  sectors: jsonb("sectors").$type<string[]>().notNull().default([]),
  activities: jsonb("activities").$type<string[]>().notNull().default([]),
  regions: jsonb("regions").$type<string[]>().notNull().default([]),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  updatedBy: varchar("updated_by", { length: 64 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchingRecords = pgTable(
  "matching_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    sector: varchar("sector", { length: 120 }),
    activity: varchar("activity", { length: 120 }),
    region: varchar("region", { length: 160 }),
    deadline: date("deadline", { mode: "string" }),
    sourceUrl: varchar("source_url", { length: 500 }),
    /** open | closed */
    status: varchar("status", { length: 12 }).notNull().default("open"),
    createdBy: varchar("created_by", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matching_records_org_idx").on(t.organizationId, t.status, t.deadline),
    index("matching_records_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const matchingFeedback = pgTable(
  "matching_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    recordId: uuid("record_id").notNull(),
    /** relevant | not_relevant | interested */
    verdict: varchar("verdict", { length: 16 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("matching_feedback_org_record_idx").on(t.organizationId, t.recordId)],
);

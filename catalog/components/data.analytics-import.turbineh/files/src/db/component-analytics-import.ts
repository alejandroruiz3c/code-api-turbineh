import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Imported analytics rows (component data.analytics-import.turbineh): one row per CSV line of an accepted file, with
 * its date, dimensions (shop, product…) and measures (revenue, quantity…). Files are imported whole or not at all; the
 * per-record scope (e.g. the shop) limits who sees each row (src/server/record-access.ts).
 */
export const analyticsImports = pgTable("analytics_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: varchar("organization_id", { length: 64 }).notNull(),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  rows: integer("rows").notNull(),
  createdBy: varchar("created_by", { length: 64 }).notNull(),
  createdByEmail: varchar("created_by_email", { length: 320 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analyticsRows = pgTable(
  "analytics_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    importId: uuid("import_id")
      .notNull()
      .references(() => analyticsImports.id, { onDelete: "cascade" }),
    scopeId: uuid("scope_id"),
    day: date("day").notNull(),
    dimensions: jsonb("dimensions").$type<Record<string, string>>().notNull(),
    measures: jsonb("measures").$type<Record<string, number>>().notNull(),
  },
  (t) => [
    index("analytics_rows_org_day_idx").on(t.organizationId, t.day),
    index("analytics_rows_scope_idx").on(t.organizationId, t.scopeId),
  ],
);

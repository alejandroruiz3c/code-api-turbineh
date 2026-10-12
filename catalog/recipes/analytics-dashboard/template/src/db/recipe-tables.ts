import { date, index, numeric, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** A dataset is a named series of dated, categorised values (recipe analytics-dashboard). */
export const datasets = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: varchar("organization_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  unit: varchar("unit", { length: 24 }).notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dataPoints = pgTable(
  "data_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    category: varchar("category", { length: 80 }).notNull().default("General"),
    value: numeric("value", { precision: 16, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("data_points_dataset_day_idx").on(t.datasetId, t.day)],
);

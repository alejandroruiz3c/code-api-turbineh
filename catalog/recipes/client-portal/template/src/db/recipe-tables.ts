import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Client requests (recipe client-portal). Clients see their own; owners and admins see and update all. */
export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("submitted"),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("requests_org_idx").on(t.organizationId, t.createdAt)],
);

/** Files attached to a request. Stored in Postgres for the beta (bounded size); type checked by content. */
export const requestFiles = pgTable(
  "request_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    uploadedBy: varchar("uploaded_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("request_files_request_idx").on(t.requestId)],
);

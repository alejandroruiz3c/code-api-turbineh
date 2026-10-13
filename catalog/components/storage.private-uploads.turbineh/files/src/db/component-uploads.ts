import { index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Private uploads (component storage.private-uploads.turbineh): one row per stored file. The bytes live in the private
 * storage (local directory outside public/ or an S3 bucket) under `storageKey`; this row decides who may read them
 * (workspace + per-record scope, see src/server/record-access.ts).
 */
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    /** Per-record access scope (company, project, shop); null = the whole workspace. */
    scopeId: uuid("scope_id"),
    /** What the file belongs to, e.g. "workflow:request" + the record id; "workspace" for loose files. */
    subjectType: varchar("subject_type", { length: 60 }).notNull(),
    subjectId: varchar("subject_id", { length: 64 }),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    fileType: varchar("file_type", { length: 8 }).notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    size: integer("size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storageKey: varchar("storage_key", { length: 120 }).notNull(),
    uploadedBy: varchar("uploaded_by", { length: 64 }).notNull(),
    uploadedByEmail: varchar("uploaded_by_email", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("uploads_subject_idx").on(t.organizationId, t.subjectType, t.subjectId),
    index("uploads_scope_idx").on(t.organizationId, t.scopeId),
  ],
);

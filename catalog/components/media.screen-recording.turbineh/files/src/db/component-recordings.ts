import {
  bigint,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Screen and camera recordings (component media.screen-recording.turbineh): one row per uploaded video. The bytes live
 * in the private storage of storage.private-uploads.turbineh (local directory outside public/ or a private S3 bucket)
 * under `storageKey`; this row decides who may watch it (the workspace, or whoever holds the share link — only the
 * link's SHA-256 is stored).
 */
export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    storageKey: varchar("storage_key", { length: 120 }).notNull(),
    container: varchar("container", { length: 8 }).notNull(),
    mime: varchar("mime", { length: 40 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** What was recorded (the output canvas), and what the person asked for. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    requestedWidth: integer("requested_width").notNull(),
    requestedHeight: integer("requested_height").notNull(),
    frameRate: integer("frame_rate").notNull(),
    layout: varchar("layout", { length: 20 }).notNull(),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    shareTokenHash: varchar("share_token_hash", { length: 64 }),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("recordings_org_idx").on(t.organizationId, t.createdAt),
    uniqueIndex("recordings_share_idx").on(t.shareTokenHash),
  ],
);

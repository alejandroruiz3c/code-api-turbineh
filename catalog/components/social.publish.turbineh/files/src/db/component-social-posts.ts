import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Social posts (component social.publish.turbineh): one row per post and connected account. The idempotency key is
 * unique per workspace, so a form sent twice, a retried request or two schedulers never create or publish a post
 * twice; a post is published only by the runner that claimed it (status `publishing` with a lease).
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    connectionId: uuid("connection_id").notNull(),
    network: varchar("network", { length: 12 }).notNull(),
    /** Unique per workspace: one post per key, whatever retries or double submits happen. */
    idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(),
    text: text("text").notNull(),
    imageUrl: varchar("image_url", { length: 2048 }),
    /** UTC instant to publish at, and the IANA zone it was typed in. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    scheduledTimeZone: varchar("scheduled_time_zone", { length: 64 }).notNull().default("UTC"),
    /**
     * draft | pending_approval | scheduled | publishing | retrying | published | failed | unknown | cancelled.
     * `unknown`: an attempt was interrupted after it was sent; a person checks the network before retrying.
     */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    externalId: varchar("external_id", { length: 200 }),
    externalUrl: varchar("external_url", { length: 2048 }),
    lastError: varchar("last_error", { length: 300 }),
    createdBy: varchar("created_by", { length: 64 }).notNull(),
    approvedBy: varchar("approved_by", { length: 64 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_posts_idempotency_idx").on(t.organizationId, t.idempotencyKey),
    index("social_posts_due_idx").on(t.status, t.nextAttemptAt),
    index("social_posts_org_idx").on(t.organizationId, t.scheduledAt),
  ],
);

/**
 * Publication log (append-only in code and in the database, src/db/sql/120-social-publication-log.sql): one row per
 * attempt and per decision (approved, cancelled), with the outcome, the provider's status and its short reason.
 */
export const socialPublicationLog = pgTable(
  "social_publication_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    postId: uuid("post_id").notNull(),
    network: varchar("network", { length: 12 }).notNull(),
    /** created | submitted | approved | scheduled | attempt | published | retry | failed | unknown | cancelled */
    event: varchar("event", { length: 20 }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    httpStatus: integer("http_status"),
    detail: varchar("detail", { length: 300 }),
    actorId: varchar("actor_id", { length: 64 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_publication_log_post_idx").on(t.organizationId, t.postId, t.at)],
);

import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Engagement snapshots of published social posts (component social.metrics.turbineh): one row per post and fetch.
 * A metric the network does not give for that kind of post (or that needs a permission the app lacks) stays null —
 * never 0, which would be a claim.
 */
export const socialPostMetrics = pgTable(
  "social_post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: varchar("organization_id", { length: 64 }).notNull(),
    postId: uuid("post_id").notNull(),
    network: varchar("network", { length: 12 }).notNull(),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    /** Impressions or views, as the network names them (X impression_count, Instagram views). */
    impressions: integer("impressions"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_post_metrics_fetch_idx").on(t.postId, t.fetchedAt),
    index("social_post_metrics_org_idx").on(t.organizationId, t.postId, t.fetchedAt),
  ],
);

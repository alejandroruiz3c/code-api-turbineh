import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Public site entries (component site.public-pages.turbineh): the records of every public collection (portfolio
 * projects, open positions, team members…). Only published entries are ever shown to visitors; staff edit them.
 */
export const siteEntries = pgTable(
  "site_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Collection key from src/site-pages/params.json (its public path without "/"). */
    collection: varchar("collection", { length: 60 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    summary: varchar("summary", { length: 300 }).notNull().default(""),
    body: text("body").notNull().default(""),
    imageUrl: varchar("image_url", { length: 500 }),
    /** Values of the collection's filter fields, e.g. { "sector": "Bridges" }. */
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    published: boolean("published").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("site_entries_collection_slug_idx").on(t.collection, t.slug),
    index("site_entries_collection_idx").on(t.collection, t.published, t.sort),
  ],
);

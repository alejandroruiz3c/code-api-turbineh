import {
  boolean,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** Blog posts (recipe corporate-site). Body is Markdown, rendered without raw HTML. */
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    title: varchar("title", { length: 160 }).notNull(),
    excerpt: varchar("excerpt", { length: 300 }).notNull(),
    body: text("body").notNull(),
    published: boolean("published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_published_idx").on(t.published, t.publishedAt)],
);

/** Messages from the public contact form. */
export const contactMessages = pgTable("contact_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  company: varchar("company", { length: 160 }),
  message: text("message").notNull(),
  handled: boolean("handled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Website texts edited from the admin panel (single row; defaults live in src/content/site.ts). */
export const siteSettings = pgTable("site_settings", {
  id: smallint("id").primaryKey().default(1),
  content: jsonb("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

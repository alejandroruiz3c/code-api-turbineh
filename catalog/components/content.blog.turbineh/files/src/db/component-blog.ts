import { index, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * The site's blog (component content.blog.turbineh): authors, posts (Markdown body, draft or published), tags. One
 * blog per app — it is the public website's, read without an account and written by staff (ADMIN_EMAILS).
 */
export const blogAuthors = pgTable("blog_authors", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  bio: text("bio").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blogPosts = pgTable(
  "blog_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    title: varchar("title", { length: 160 }).notNull(),
    excerpt: varchar("excerpt", { length: 300 }).notNull(),
    /** Markdown (rendered without raw HTML); the frontmatter typed in the editor is not stored here. */
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => blogAuthors.id, { onDelete: "set null" }),
    /** draft (never public) | published. */
    status: varchar("status", { length: 12 }).notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("blog_posts_status_idx").on(t.status, t.publishedAt)],
);

export const blogTags = pgTable("blog_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 40 }).notNull(),
});

export const blogPostTags = pgTable(
  "blog_post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => blogPosts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => blogTags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index("blog_post_tags_tag_idx").on(t.tagId),
  ],
);

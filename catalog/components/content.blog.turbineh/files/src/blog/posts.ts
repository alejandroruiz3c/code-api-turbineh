import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { blogAuthors, blogPosts, blogPostTags, blogTags } from "@/db/schema";
import { env } from "@/env";
import { UserFacingError } from "@/security/errors";
import { blogConfig } from "./config";
import {
  excerptOf,
  isSlug,
  likePattern,
  parseFrontmatter,
  parseTags,
  readingMinutes,
  slugify,
} from "./text";

/**
 * The blog's data (component content.blog.turbineh). Public reads return published posts only — a draft is never
 * listed, shown, put in the RSS feed or in the sitemap. Writes are called by the staff-only server actions in
 * src/app/dashboard/blog/actions.ts (requireAdmin), never from public pages.
 */

/** Absolute URL of a site path (BETTER_AUTH_URL is the public address of the app). */
export const absoluteUrl = (path: string): string =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}${path}`;

export interface PostCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date | null;
  updatedAt: Date;
  readingMinutes: number;
  author: { slug: string; name: string } | null;
  tags: { slug: string; name: string }[];
}

const published = eq(blogPosts.status, "published");

async function tagsOf(postIds: string[]): Promise<Map<string, { slug: string; name: string }[]>> {
  const out = new Map<string, { slug: string; name: string }[]>();
  if (postIds.length === 0) return out;
  const rows = await db
    .select({ postId: blogPostTags.postId, slug: blogTags.slug, name: blogTags.name })
    .from(blogPostTags)
    .innerJoin(blogTags, eq(blogTags.id, blogPostTags.tagId))
    .where(inArray(blogPostTags.postId, postIds))
    .orderBy(blogTags.name);
  for (const r of rows)
    out.set(r.postId, [...(out.get(r.postId) ?? []), { slug: r.slug, name: r.name }]);
  return out;
}

const cardColumns = {
  id: blogPosts.id,
  slug: blogPosts.slug,
  title: blogPosts.title,
  excerpt: blogPosts.excerpt,
  body: blogPosts.body,
  publishedAt: blogPosts.publishedAt,
  updatedAt: blogPosts.updatedAt,
  authorSlug: blogAuthors.slug,
  authorName: blogAuthors.name,
};

async function cards(
  rows: {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    publishedAt: Date | null;
    updatedAt: Date;
    authorSlug: string | null;
    authorName: string | null;
  }[],
): Promise<PostCard[]> {
  const tags = await tagsOf(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    readingMinutes: readingMinutes(r.body, blogConfig.wordsPerMinute),
    author: r.authorSlug && r.authorName ? { slug: r.authorSlug, name: r.authorName } : null,
    tags: tags.get(r.id) ?? [],
  }));
}

/**
 * One page of published posts, newest first: all of them, those matching a keyword (title, excerpt or text), those
 * with a tag, or those of an author. `page` starts at 1; `pages` is at least 1.
 */
export async function listPublished(
  opts: { page?: number; q?: string; tag?: string; author?: string; limit?: number } = {},
): Promise<{ posts: PostCard[]; page: number; pages: number; total: number }> {
  const limit = opts.limit ?? blogConfig.postsPerPage;
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const filters = [published];
  const q = opts.q?.trim();
  if (q) {
    const p = likePattern(q);
    filters.push(
      or(ilike(blogPosts.title, p), ilike(blogPosts.excerpt, p), ilike(blogPosts.body, p)) ??
        published,
    );
  }
  if (opts.tag !== undefined) {
    if (!isSlug(opts.tag)) return { posts: [], page: 1, pages: 1, total: 0 };
    filters.push(
      inArray(
        blogPosts.id,
        db
          .select({ id: blogPostTags.postId })
          .from(blogPostTags)
          .innerJoin(blogTags, eq(blogTags.id, blogPostTags.tagId))
          .where(eq(blogTags.slug, opts.tag)),
      ),
    );
  }
  if (opts.author !== undefined) {
    if (!isSlug(opts.author)) return { posts: [], page: 1, pages: 1, total: 0 };
    filters.push(eq(blogAuthors.slug, opts.author));
  }
  const where = and(...filters);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select(cardColumns)
      .from(blogPosts)
      .leftJoin(blogAuthors, eq(blogAuthors.id, blogPosts.authorId))
      .where(where)
      .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: count() })
      .from(blogPosts)
      .leftJoin(blogAuthors, eq(blogAuthors.id, blogPosts.authorId))
      .where(where),
  ]);
  return {
    posts: await cards(rows),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  };
}

/** A published post by slug, with its Markdown body; null for drafts and unknown slugs. */
export async function getPublished(
  slug: string,
): Promise<(PostCard & { body: string; bio: string }) | null> {
  if (!isSlug(slug)) return null;
  const [row] = await db
    .select({ ...cardColumns, bio: blogAuthors.bio })
    .from(blogPosts)
    .leftJoin(blogAuthors, eq(blogAuthors.id, blogPosts.authorId))
    .where(and(published, eq(blogPosts.slug, slug)));
  if (!row) return null;
  const [card] = await cards([row]);
  return card ? { ...card, body: row.body, bio: row.bio ?? "" } : null;
}

export async function getTag(slug: string): Promise<{ slug: string; name: string } | null> {
  if (!isSlug(slug)) return null;
  const [t] = await db
    .select({ slug: blogTags.slug, name: blogTags.name })
    .from(blogTags)
    .where(eq(blogTags.slug, slug));
  return t ?? null;
}

export async function getAuthor(
  slug: string,
): Promise<{ id: string; slug: string; name: string; bio: string } | null> {
  if (!isSlug(slug)) return null;
  const [a] = await db.select().from(blogAuthors).where(eq(blogAuthors.slug, slug));
  return a ? { id: a.id, slug: a.slug, name: a.name, bio: a.bio } : null;
}

/** Everything the sitemap lists: published posts, and the tags and authors that have published posts. */
export async function sitemapEntries(): Promise<{
  posts: { slug: string; updatedAt: Date }[];
  tags: string[];
  authors: string[];
}> {
  const [posts, tags, authors] = await Promise.all([
    db
      .select({ slug: blogPosts.slug, updatedAt: blogPosts.updatedAt })
      .from(blogPosts)
      .where(published)
      .orderBy(desc(blogPosts.publishedAt)),
    db
      .selectDistinct({ slug: blogTags.slug })
      .from(blogTags)
      .innerJoin(blogPostTags, eq(blogPostTags.tagId, blogTags.id))
      .innerJoin(blogPosts, eq(blogPosts.id, blogPostTags.postId))
      .where(published),
    db
      .selectDistinct({ slug: blogAuthors.slug })
      .from(blogAuthors)
      .innerJoin(blogPosts, eq(blogPosts.authorId, blogAuthors.id))
      .where(published),
  ]);
  return { posts, tags: tags.map((t) => t.slug), authors: authors.map((a) => a.slug) };
}

// ─── Staff (callers check requireAdmin) ───────────────────────────────────────────────────────────────────────

export async function listAllForStaff() {
  return db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      status: blogPosts.status,
      updatedAt: blogPosts.updatedAt,
      author: blogAuthors.name,
    })
    .from(blogPosts)
    .leftJoin(blogAuthors, eq(blogAuthors.id, blogPosts.authorId))
    .orderBy(desc(blogPosts.updatedAt))
    .limit(200);
}

export async function getForStaff(id: string) {
  const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
  if (!post) return null;
  const tags = (await tagsOf([id])).get(id) ?? [];
  return { ...post, tags: tags.map((t) => t.name) };
}

export async function listAuthors() {
  return db.select().from(blogAuthors).orderBy(blogAuthors.name);
}

async function uniqueSlug(
  table: typeof blogPosts | typeof blogAuthors,
  wanted: string,
  ownId: string | null,
): Promise<string> {
  let slug = wanted;
  for (let i = 2; i < 50; i++) {
    const [taken] = await db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
    if (!taken || taken.id === ownId) return slug;
    slug = `${wanted.slice(0, 110)}-${i}`;
  }
  throw new UserFacingError("Choose another slug.");
}

/** Finds an author by slug or name, creating it when the frontmatter names a new one. */
async function authorFor(nameOrSlug: string): Promise<string> {
  const slug = slugify(nameOrSlug, "author");
  const [found] = await db
    .select({ id: blogAuthors.id })
    .from(blogAuthors)
    .where(
      or(eq(blogAuthors.slug, slug), sql`lower(${blogAuthors.name}) = ${nameOrSlug.toLowerCase()}`),
    );
  if (found) return found.id;
  const [created] = await db
    .insert(blogAuthors)
    .values({ slug: await uniqueSlug(blogAuthors, slug, null), name: nameOrSlug.slice(0, 120) })
    .returning({ id: blogAuthors.id });
  if (!created) throw new Error("author not created");
  return created.id;
}

export interface PostInput {
  id: string | null;
  title?: string;
  slug?: string;
  excerpt?: string;
  authorId?: string | null;
  tags?: string;
  /** Markdown, optionally starting with frontmatter (it fills or overrides the fields above). */
  source: string;
  intent: "draft" | "publish";
}

/**
 * Creates or updates a post. Frontmatter at the top of the Markdown wins over the form fields; the stored body is the
 * Markdown after it. `intent` draft keeps (or makes) it private; publish makes it public, keeping its first
 * publication date. Returns the post's id, slug and status.
 */
export async function savePost(
  input: PostInput,
): Promise<{ id: string; slug: string; status: string }> {
  const fm = parseFrontmatter(input.source);
  const title = (fm.data.title ?? input.title ?? "").trim();
  const body = fm.body;
  if (title.length < 3 || title.length > 160)
    throw new UserFacingError("A title of 3 to 160 characters is required (field or frontmatter).");
  if (body.length < 10 || body.length > 100_000)
    throw new UserFacingError("The text needs 10 to 100,000 characters.");
  const excerpt = (fm.data.excerpt ?? input.excerpt ?? "").trim() || excerptOf(body);
  if (excerpt.length > 300)
    throw new UserFacingError("The summary may have at most 300 characters.");
  const wantedSlug = slugify(fm.data.slug ?? input.slug ?? "", "") || slugify(title);
  const authorId = fm.data.author ? await authorFor(fm.data.author) : (input.authorId ?? null);
  const tags = parseTags(fm.data.tags ?? input.tags ?? "");
  const status = fm.data.status
    ? fm.data.status
    : input.intent === "publish"
      ? "published"
      : "draft";
  const current = input.id
    ? (
        await db
          .select({ id: blogPosts.id, publishedAt: blogPosts.publishedAt })
          .from(blogPosts)
          .where(eq(blogPosts.id, input.id))
      )[0]
    : null;
  if (input.id && !current) throw new UserFacingError("Post not found.");
  const slug = await uniqueSlug(blogPosts, wantedSlug, current?.id ?? null);
  const values = {
    slug,
    title,
    excerpt,
    body,
    authorId,
    status,
    publishedAt:
      status === "published"
        ? (current?.publishedAt ?? new Date())
        : (current?.publishedAt ?? null),
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    let id: string;
    if (current) {
      await tx.update(blogPosts).set(values).where(eq(blogPosts.id, current.id));
      id = current.id;
    } else {
      const [row] = await tx.insert(blogPosts).values(values).returning({ id: blogPosts.id });
      if (!row) throw new Error("post not created");
      id = row.id;
    }
    await tx.delete(blogPostTags).where(eq(blogPostTags.postId, id));
    for (const t of tags) {
      await tx.insert(blogTags).values(t).onConflictDoNothing({ target: blogTags.slug });
      const [tag] = await tx
        .select({ id: blogTags.id })
        .from(blogTags)
        .where(eq(blogTags.slug, t.slug));
      if (tag)
        await tx.insert(blogPostTags).values({ postId: id, tagId: tag.id }).onConflictDoNothing();
    }
    return { id, slug, status };
  });
}

/** Publishes or unpublishes (back to draft) a post; the first publication date is kept. */
export async function setStatus(id: string, status: "draft" | "published"): Promise<void> {
  const [post] = await db
    .select({ publishedAt: blogPosts.publishedAt })
    .from(blogPosts)
    .where(eq(blogPosts.id, id));
  if (!post) throw new UserFacingError("Post not found.");
  await db
    .update(blogPosts)
    .set({
      status,
      publishedAt: status === "published" ? (post.publishedAt ?? new Date()) : post.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(blogPosts.id, id));
}

export async function deletePost(id: string): Promise<void> {
  await db.delete(blogPosts).where(eq(blogPosts.id, id));
}

export async function saveAuthor(input: { id: string | null; name: string; bio: string }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new UserFacingError("Name: 2 to 120 characters.");
  const bio = input.bio.trim().slice(0, 1000);
  if (input.id) {
    await db.update(blogAuthors).set({ name, bio }).where(eq(blogAuthors.id, input.id));
    return;
  }
  await db
    .insert(blogAuthors)
    .values({ name, bio, slug: await uniqueSlug(blogAuthors, slugify(name, "author"), null) });
}

export async function deleteAuthor(id: string): Promise<void> {
  await db.delete(blogAuthors).where(eq(blogAuthors.id, id));
}

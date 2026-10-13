import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { siteEntries } from "@/db/schema";
import { env } from "@/env";
import { collections, type Collection } from "./config";
import { matchesFilters, slugify } from "./rules";

/**
 * Site entries (component site.public-pages.turbineh): the only code that reads or writes public collection entries.
 * Visitor reads return published entries only; writes are called from staff actions (requireAdmin).
 */
export type Entry = typeof siteEntries.$inferSelect;

export const absoluteUrl = (path: string) => `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}${path}`;

/** Published entries of a collection, filtered by the visitor's choices (unknown filters are ignored). */
export async function publishedEntries(c: Collection, filters: Record<string, string> = {}) {
  const rows = await db
    .select()
    .from(siteEntries)
    .where(and(eq(siteEntries.collection, c.key), eq(siteEntries.published, true)))
    .orderBy(asc(siteEntries.sort), desc(siteEntries.createdAt))
    .limit(500);
  const allowed = Object.fromEntries(
    Object.entries(filters).filter(([k, v]) => v && c.filters.some((f) => f.key === k)),
  );
  return {
    rows: rows.filter((r) => matchesFilters(r.attributes, allowed)),
    /** Distinct values of each filter among published entries (the options visitors see). */
    options: Object.fromEntries(
      c.filters.map((f) => [
        f.key,
        [...new Set(rows.map((r) => r.attributes[f.key]).filter((v): v is string => !!v))].sort(),
      ]),
    ),
  };
}

export async function publishedEntry(c: Collection, slug: string): Promise<Entry | null> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  const [row] = await db
    .select()
    .from(siteEntries)
    .where(
      and(
        eq(siteEntries.collection, c.key),
        eq(siteEntries.slug, slug),
        eq(siteEntries.published, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Every published page URL of every collection (for the sitemap). */
export async function sitemapEntries(): Promise<{ url: string; lastModified?: Date }[]> {
  const rows = await db
    .select({
      collection: siteEntries.collection,
      slug: siteEntries.slug,
      updatedAt: siteEntries.updatedAt,
    })
    .from(siteEntries)
    .where(eq(siteEntries.published, true));
  return [
    ...collections.map((c) => ({ url: absoluteUrl(c.path) })),
    ...rows
      .filter((r) => collections.some((c) => c.key === r.collection && c.detail))
      .map((r) => ({ url: absoluteUrl(`/${r.collection}/${r.slug}`), lastModified: r.updatedAt })),
  ];
}

// ─── Staff ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function allEntries(c: Collection) {
  return db
    .select()
    .from(siteEntries)
    .where(eq(siteEntries.collection, c.key))
    .orderBy(asc(siteEntries.sort), desc(siteEntries.createdAt));
}

export async function entryById(c: Collection, id: string): Promise<Entry | null> {
  const [row] = await db
    .select()
    .from(siteEntries)
    .where(and(eq(siteEntries.collection, c.key), eq(siteEntries.id, id)))
    .limit(1);
  return row ?? null;
}

export interface EntryInput {
  title: string;
  slug?: string;
  summary: string;
  body: string;
  imageUrl: string | null;
  attributes: Record<string, string>;
  published: boolean;
  sort: number;
}

/** Creates or updates an entry; the slug comes from the title when empty and stays unique in its collection. */
export async function saveEntry(c: Collection, input: EntryInput, id?: string): Promise<string> {
  const base = slugify(input.slug || input.title) || "page";
  let slug = base;
  for (let n = 2; ; n++) {
    const [clash] = await db
      .select({ id: siteEntries.id })
      .from(siteEntries)
      .where(and(eq(siteEntries.collection, c.key), eq(siteEntries.slug, slug)))
      .limit(1);
    if (!clash || clash.id === id) break;
    slug = `${base}-${n}`;
  }
  const attributes = Object.fromEntries(
    c.filters.map((f) => [f.key, (input.attributes[f.key] ?? "").trim().slice(0, 80)]),
  );
  const values = { ...input, slug, attributes, updatedAt: new Date() };
  if (id) {
    await db
      .update(siteEntries)
      .set(values)
      .where(and(eq(siteEntries.collection, c.key), eq(siteEntries.id, id)));
    return id;
  }
  const [row] = await db
    .insert(siteEntries)
    .values({ ...values, collection: c.key })
    .returning({ id: siteEntries.id });
  if (!row) throw new Error("entry not created");
  return row.id;
}

export async function deleteEntry(c: Collection, id: string): Promise<void> {
  await db
    .delete(siteEntries)
    .where(and(eq(siteEntries.collection, c.key), eq(siteEntries.id, id)));
}

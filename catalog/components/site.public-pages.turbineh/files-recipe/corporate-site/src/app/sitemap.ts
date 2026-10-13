import { desc, eq } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { absolute } from "@/lib/seo";
import { sitemapEntries } from "@/site-pages/service";

export const dynamic = "force-dynamic";

/** Public pages, published posts and published collection pages; the admin area and drafts are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await db
    .select({ slug: posts.slug, updatedAt: posts.updatedAt })
    .from(posts)
    .where(eq(posts.published, true))
    .orderBy(desc(posts.publishedAt));
  return [
    ...["/", "/services", "/about", "/blog", "/contact"].map((p) => ({
      url: absolute(p),
      changeFrequency: "weekly" as const,
    })),
    ...rows.map((p) => ({ url: absolute(`/blog/${p.slug}`), lastModified: p.updatedAt })),
    // Public collections and their published pages (site.public-pages.turbineh).
    ...(await sitemapEntries()),
  ];
}

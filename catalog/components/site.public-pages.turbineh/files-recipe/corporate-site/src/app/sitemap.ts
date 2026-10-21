import type { MetadataRoute } from "next";
import { sitemapEntries as blogEntries } from "@/blog/posts";
import { absolute } from "@/lib/seo";
import { sitemapEntries } from "@/site-pages/service";

export const dynamic = "force-dynamic";

/** Public pages, published posts and published collection pages; the admin area and drafts are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { posts } = await blogEntries();
  return [
    ...["/", "/services", "/about", "/blog", "/contact"].map((p) => ({
      url: absolute(p),
      changeFrequency: "weekly" as const,
    })),
    // Published blog posts (content.blog.turbineh).
    ...posts.map((p) => ({ url: absolute(`/blog/${p.slug}`), lastModified: p.updatedAt })),
    // Public collections and their published pages (site.public-pages.turbineh).
    ...(await sitemapEntries()),
  ];
}

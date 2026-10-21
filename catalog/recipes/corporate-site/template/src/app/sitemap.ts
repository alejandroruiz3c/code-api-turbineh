import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/blog/posts";
import { absolute } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** Public pages and published posts; the admin area and drafts are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { posts } = await sitemapEntries();
  return [
    ...["/", "/services", "/about", "/blog", "/contact"].map((p) => ({
      url: absolute(p),
      changeFrequency: "weekly" as const,
    })),
    ...posts.map((p) => ({ url: absolute(`/blog/${p.slug}`), lastModified: p.updatedAt })),
  ];
}

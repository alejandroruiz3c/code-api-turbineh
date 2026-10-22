import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/blog/posts";
import { env } from "@/env";

export const dynamic = "force-dynamic";

/** Public pages: the landing page, the blog and its published posts; the admin area and drafts are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { posts } = await sitemapEntries();
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/blog`, changeFrequency: "daily" },
    ...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt })),
  ];
}

import type { MetadataRoute } from "next";
import { absoluteUrl, sitemapEntries } from "@/blog/posts";

export const dynamic = "force-dynamic";

/** /blog/sitemap.xml: the blog, its published posts, and the tag and author pages that have published posts. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { posts, tags, authors } = await sitemapEntries();
  return [
    { url: absoluteUrl("/blog"), changeFrequency: "daily" },
    ...posts.map((p) => ({ url: absoluteUrl(`/blog/${p.slug}`), lastModified: p.updatedAt })),
    ...tags.map((t) => ({
      url: absoluteUrl(`/blog/tag/${t}`),
      changeFrequency: "weekly" as const,
    })),
    ...authors.map((a) => ({
      url: absoluteUrl(`/blog/author/${a}`),
      changeFrequency: "weekly" as const,
    })),
  ];
}

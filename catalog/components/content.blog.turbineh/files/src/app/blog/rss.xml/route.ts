import { blogConfig } from "@/blog/config";
import { absoluteUrl, listPublished } from "@/blog/posts";
import { xml } from "@/blog/text";

export const dynamic = "force-dynamic";

/** RSS 2.0 feed of the latest published posts (feedItems from src/blog/params.json); drafts never appear. */
export async function GET(): Promise<Response> {
  const { posts } = await listPublished({ limit: blogConfig.feedItems });
  const items = posts
    .map((p) => {
      const link = xml(absoluteUrl(`/blog/${p.slug}`));
      return [
        "<item>",
        `<title>${xml(p.title)}</title>`,
        `<link>${link}</link>`,
        `<guid isPermaLink="true">${link}</guid>`,
        `<description>${xml(p.excerpt)}</description>`,
        p.author ? `<dc:creator>${xml(p.author.name)}</dc:creator>` : "",
        ...p.tags.map((t) => `<category>${xml(t.name)}</category>`),
        p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : "",
        "</item>",
      ].join("");
    })
    .join("");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom"><channel>` +
    `<title>${xml("__APP_NAME__")}</title><link>${xml(absoluteUrl("/blog"))}</link>` +
    `<atom:link href="${xml(absoluteUrl("/blog/rss.xml"))}" rel="self" type="application/rss+xml"/>` +
    `<description>${xml("__APP_NAME__ blog")}</description>${items}</channel></rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

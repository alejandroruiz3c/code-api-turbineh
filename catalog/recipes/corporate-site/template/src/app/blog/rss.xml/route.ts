import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { absolute, xml } from "@/lib/seo";

/** RSS 2.0 feed of the 20 latest published posts. */
export async function GET(): Promise<Response> {
  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.published, true))
    .orderBy(desc(posts.publishedAt))
    .limit(20);
  const items = rows
    .map(
      (p) =>
        `<item><title>${xml(p.title)}</title><link>${xml(absolute(`/blog/${p.slug}`))}</link><guid>${xml(absolute(`/blog/${p.slug}`))}</guid><description>${xml(p.excerpt)}</description>${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ""}</item>`,
    )
    .join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml("__APP_NAME__")}</title><link>${xml(absolute("/blog"))}</link><description>${xml("__APP_NAME__ blog")}</description>${items}</channel></rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

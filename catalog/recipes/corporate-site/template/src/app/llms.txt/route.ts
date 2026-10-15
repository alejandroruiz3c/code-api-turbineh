import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { line } from "@/lib/geo";
import { absolute } from "@/lib/seo";
import { getSite } from "@/server/site";

export const dynamic = "force-dynamic";

/** /llms.txt — a concise, factual summary of this company for AI assistants and answer engines. */
export async function GET(): Promise<Response> {
  const site = await getSite();
  const latest = await db
    .select({ slug: posts.slug, title: posts.title, excerpt: posts.excerpt })
    .from(posts)
    .where(eq(posts.published, true))
    .orderBy(desc(posts.publishedAt))
    .limit(20);
  const body = [
    "# __APP_NAME__",
    "",
    `> ${line(site.hero_subtitle)}`,
    "",
    line(site.about, 1200),
    "",
    "## Services",
    ...site.services.map((s) => `- ${line(s.title, 80)}: ${line(s.text)}`),
    "",
    "## FAQ",
    ...site.faq.flatMap((f) => [`- Q: ${line(f.q, 160)}`, `  A: ${line(f.a, 500)}`]),
    "",
    "## Pages",
    `- [Services](${absolute("/services")})`,
    `- [About](${absolute("/about")})`,
    `- [Blog](${absolute("/blog")})`,
    `- [Contact](${absolute("/contact")})`,
    ...(latest.length
      ? [
          "",
          "## Articles",
          ...latest.map(
            (p) => `- [${line(p.title, 120)}](${absolute(`/blog/${p.slug}`)}): ${line(p.excerpt)}`,
          ),
        ]
      : []),
  ].join("\n");
  return new Response(`${body}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

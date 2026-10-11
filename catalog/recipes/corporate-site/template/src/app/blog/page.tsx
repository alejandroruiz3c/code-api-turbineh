import { and, count, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { getSite } from "@/server/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Blog — __APP_NAME__",
  alternates: { canonical: "/blog", types: { "application/rss+xml": "/blog/rss.xml" } },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Blog({ searchParams }: { searchParams: SearchParams }) {
  const site = await getSite();
  const { page, offset, limit } = parsePage((await searchParams).page);
  const where = and(eq(posts.published, true));
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        slug: posts.slug,
        title: posts.title,
        excerpt: posts.excerpt,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(where)
      .orderBy(desc(posts.publishedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(posts).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <SiteShell cta={site.cta}>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-8 text-4xl font-bold">Blog</h1>
        {rows.length === 0 ? <p className="text-slate-600">No articles yet.</p> : null}
        <ul className="flex flex-col gap-8">
          {rows.map((p) => (
            <li key={p.slug}>
              <h2 className="text-2xl font-semibold">
                <Link href={`/blog/${p.slug}`} className="hover:underline">
                  {p.title}
                </Link>
              </h2>
              <p className="text-sm text-slate-500">{p.publishedAt?.toISOString().slice(0, 10)}</p>
              <p className="mt-2 text-slate-700">{p.excerpt}</p>
            </li>
          ))}
        </ul>
        <nav aria-label="Pagination" className="mt-10 flex gap-4 text-sm">
          {page > 1 ? <Link href={`/blog?page=${page - 1}`}>Newer</Link> : null}
          {page < pages ? <Link href={`/blog?page=${page + 1}`}>Older</Link> : null}
        </nav>
      </section>
    </SiteShell>
  );
}

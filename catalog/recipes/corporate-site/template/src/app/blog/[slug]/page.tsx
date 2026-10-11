import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { Markdown } from "@/lib/markdown";
import { absolute, jsonLd } from "@/lib/seo";
import { getSite } from "@/server/site";

export const dynamic = "force-dynamic";
type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  const [p] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.published, true)));
  return p ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Not found" };
  return {
    title: `${p.title} — __APP_NAME__`,
    description: p.excerpt,
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: {
      title: p.title,
      description: p.excerpt,
      type: "article",
      url: absolute(`/blog/${p.slug}`),
    },
  };
}

export default async function Post({ params }: { params: Params }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const site = await getSite();
  const article = jsonLd({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.excerpt,
    datePublished: p.publishedAt?.toISOString(),
    publisher: { "@type": "Organization", name: "__APP_NAME__" },
  });
  return (
    <SiteShell cta={site.cta}>
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by jsonLd(), "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: article }} />
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-4xl font-bold">{p.title}</h1>
        <p className="mb-8 text-sm text-slate-500">{p.publishedAt?.toISOString().slice(0, 10)}</p>
        <Markdown source={p.body} />
      </article>
    </SiteShell>
  );
}

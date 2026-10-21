import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/blog/markdown";
import { absoluteUrl, getPublished } from "@/blog/posts";
import { BlogShell } from "@/blog/shell";
import { jsonLd } from "@/blog/text";
import { PostMeta } from "@/components/blog/post-list";

export const dynamic = "force-dynamic";
type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await getPublished((await params).slug);
  if (!p) return { title: "Not found" };
  return {
    title: `${p.title} — __APP_NAME__`,
    description: p.excerpt,
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: {
      title: p.title,
      description: p.excerpt,
      type: "article",
      url: absoluteUrl(`/blog/${p.slug}`),
      ...(p.publishedAt ? { publishedTime: p.publishedAt.toISOString() } : {}),
      ...(p.author ? { authors: [p.author.name] } : {}),
      tags: p.tags.map((t) => t.name),
    },
  };
}

/** One published post: author, date, reading time, tags, Markdown rendered without raw HTML, Article JSON-LD. */
export default async function Post({ params }: { params: Params }) {
  const p = await getPublished((await params).slug);
  if (!p) notFound();
  const article = jsonLd({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.title,
    description: p.excerpt,
    url: absoluteUrl(`/blog/${p.slug}`),
    datePublished: p.publishedAt?.toISOString(),
    dateModified: p.updatedAt.toISOString(),
    timeRequired: `PT${p.readingMinutes}M`,
    keywords: p.tags.map((t) => t.name).join(", ") || undefined,
    ...(p.author
      ? {
          author: {
            "@type": "Person",
            name: p.author.name,
            url: absoluteUrl(`/blog/author/${p.author.slug}`),
          },
        }
      : {}),
    publisher: { "@type": "Organization", name: "__APP_NAME__" },
  });
  return (
    <BlogShell>
      {/* nosemgrep: turbineh.unsanitized-html -- JSON-LD built by jsonLd(), "<" escaped */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: article }} />
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-4xl font-bold">{p.title}</h1>
        <PostMeta post={p} />
        <div className="mt-8">
          <Markdown source={p.body} />
        </div>
        {p.author ? (
          <aside className="mt-12 rounded-lg border border-line bg-panel p-6 text-sm">
            <p className="font-semibold">
              <Link href={`/blog/author/${p.author.slug}`} className="hover:underline">
                {p.author.name}
              </Link>
            </p>
            {p.bio ? <p className="mt-1 text-muted">{p.bio}</p> : null}
          </aside>
        ) : null}
        <p className="mt-10 text-sm">
          <Link href="/blog" className="underline">
            ← All posts
          </Link>
        </p>
      </article>
    </BlogShell>
  );
}

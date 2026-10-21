import type { Metadata } from "next";
import { listPublished } from "@/blog/posts";
import { BlogShell } from "@/blog/shell";
import { Pager, PostList } from "@/components/blog/post-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Blog — __APP_NAME__",
  alternates: { canonical: "/blog", types: { "application/rss+xml": "/blog/rss.xml" } },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Public blog: published posts newest first, paginated, with keyword search (?q=). */
export default async function Blog({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = one(sp.q)?.trim().slice(0, 100) ?? "";
  const { posts, page, pages, total } = await listPublished({
    page: Number(one(sp.page) ?? 1),
    ...(q ? { q } : {}),
  });
  return (
    <BlogShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-6 text-4xl font-bold">Blog</h1>
        <form role="search" action="/blog" className="mb-10 flex gap-2">
          <label htmlFor="blog-q" className="sr-only">
            Search posts
          </label>
          <input
            id="blog-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search posts"
            maxLength={100}
            className="w-full rounded-md border border-field bg-surface px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm text-brand-contrast"
          >
            Search
          </button>
        </form>
        {q ? (
          <p className="mb-6 text-sm text-muted" role="status">
            {total} result{total === 1 ? "" : "s"} for “{q}”
          </p>
        ) : null}
        <PostList posts={posts} />
        <Pager page={page} pages={pages} base={q ? `/blog?q=${encodeURIComponent(q)}` : "/blog"} />
      </section>
    </BlogShell>
  );
}

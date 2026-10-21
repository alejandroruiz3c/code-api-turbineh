import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthor, listPublished } from "@/blog/posts";
import { BlogShell } from "@/blog/shell";
import { Pager, PostList } from "@/components/blog/post-list";

export const dynamic = "force-dynamic";
type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const a = await getAuthor((await params).slug);
  return a
    ? {
        title: `${a.name} — __APP_NAME__`,
        description: a.bio.slice(0, 160),
        alternates: { canonical: `/blog/author/${a.slug}` },
      }
    : { title: "Not found" };
}

/** An author's page: name, bio and their published posts. */
export default async function AuthorPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const author = await getAuthor((await params).slug);
  if (!author) notFound();
  const page = Number((await searchParams).page ?? 1);
  const list = await listPublished({ author: author.slug, page });
  return (
    <BlogShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-4xl font-bold">{author.name}</h1>
        {author.bio ? <p className="mb-10 text-muted">{author.bio}</p> : <div className="mb-10" />}
        <PostList posts={list.posts} />
        <Pager page={list.page} pages={list.pages} base={`/blog/author/${author.slug}`} />
      </section>
    </BlogShell>
  );
}

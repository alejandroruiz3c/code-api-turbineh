import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTag, listPublished } from "@/blog/posts";
import { BlogShell } from "@/blog/shell";
import { Pager, PostList } from "@/components/blog/post-list";

export const dynamic = "force-dynamic";
type Params = Promise<{ tag: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const tag = await getTag((await params).tag);
  return tag
    ? { title: `#${tag.name} — __APP_NAME__`, alternates: { canonical: `/blog/tag/${tag.slug}` } }
    : { title: "Not found" };
}

/** Published posts with one tag, newest first. */
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const tag = await getTag((await params).tag);
  if (!tag) notFound();
  const page = Number((await searchParams).page ?? 1);
  const list = await listPublished({ tag: tag.slug, page });
  return (
    <BlogShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-8 text-4xl font-bold">Posts tagged #{tag.name}</h1>
        <PostList posts={list.posts} />
        <Pager page={list.page} pages={list.pages} base={`/blog/tag/${tag.slug}`} />
      </section>
    </BlogShell>
  );
}

import { notFound } from "next/navigation";
import { getForStaff, listAuthors } from "@/blog/posts";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/server/authz";
import { PostEditor } from "./post-editor";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The post editor (staff): Markdown with optional frontmatter, save as draft or publish. */
export default async function EditPost({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const id = (await searchParams).id;
  const post = typeof id === "string" && /^[0-9a-f-]{36}$/.test(id) ? await getForStaff(id) : null;
  if (typeof id === "string" && !post) notFound();
  const authors = (await listAuthors()).map((a) => ({ id: a.id, name: a.name }));
  return (
    <Card title={post ? "Edit post" : "New post"}>
      <PostEditor
        authors={authors}
        post={
          post
            ? {
                id: post.id,
                title: post.title,
                slug: post.slug,
                excerpt: post.excerpt,
                authorId: post.authorId,
                tags: post.tags.join(", "),
                body: post.body,
                status: post.status,
              }
            : null
        }
      />
    </Card>
  );
}

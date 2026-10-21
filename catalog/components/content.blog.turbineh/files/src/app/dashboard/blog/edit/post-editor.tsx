"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePostAction, type EditorState } from "../actions";

const area = "w-full rounded-md border border-field bg-surface px-3 py-2 font-mono text-sm";

/** Editor form: fields, or frontmatter at the top of the Markdown (which wins); Save draft / Publish. */
export function PostEditor({
  authors,
  post,
}: {
  authors: { id: string; name: string }[];
  post: {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    authorId: string | null;
    tags: string;
    body: string;
    status: string;
  } | null;
}) {
  const [state, action, pending] = useActionState<EditorState, FormData>(savePostAction, {
    error: null,
  });
  return (
    <form action={action} className="flex flex-col gap-4">
      {post ? <input type="hidden" name="id" value={post.id} /> : null}
      <div>
        <Label htmlFor="b-title">Title</Label>
        <Input id="b-title" name="title" defaultValue={post?.title} maxLength={160} />
      </div>
      <div>
        <Label htmlFor="b-slug">Slug (optional)</Label>
        <Input id="b-slug" name="slug" defaultValue={post?.slug} maxLength={120} />
      </div>
      <div>
        <Label htmlFor="b-author">Author</Label>
        <select
          id="b-author"
          name="authorId"
          defaultValue={post?.authorId ?? ""}
          className="w-full rounded-md border border-field bg-surface px-3 py-2 text-sm"
        >
          <option value="">No author</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="b-tags">Tags (comma-separated)</Label>
        <Input id="b-tags" name="tags" defaultValue={post?.tags} maxLength={500} />
      </div>
      <div>
        <Label htmlFor="b-excerpt">Summary (optional)</Label>
        <Input id="b-excerpt" name="excerpt" defaultValue={post?.excerpt} maxLength={300} />
      </div>
      <div>
        <Label htmlFor="b-body">Text (Markdown; optional frontmatter between --- lines)</Label>
        <textarea
          id="b-body"
          name="body"
          defaultValue={post?.body}
          required
          rows={16}
          className={area}
          placeholder={
            "---\ntitle: My post\ntags: [news, product]\nauthor: Jane Doe\nexcerpt: One line summary\n---\n\n# Heading\n\nText with **bold** and [links](https://example.com)."
          }
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button type="submit" name="intent" value="draft" disabled={pending}>
          Save draft
        </Button>
        <Button type="submit" name="intent" value="publish" disabled={pending}>
          Publish
        </Button>
      </div>
      {post ? (
        <p className="text-sm text-muted">
          Status: {post.status === "published" ? "Published" : "Draft"}
        </p>
      ) : null}
    </form>
  );
}

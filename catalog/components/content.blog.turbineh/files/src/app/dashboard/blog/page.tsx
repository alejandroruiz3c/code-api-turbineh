import Link from "next/link";
import { listAllForStaff } from "@/blog/posts";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { requireAdmin } from "@/server/authz";
import { deletePostAction, publishPost, unpublishPost } from "./actions";

/** Blog posts for staff: drafts and published posts, publish / unpublish / delete, links to the editor. */
export default async function BlogPosts() {
  await requireAdmin();
  const rows = await listAllForStaff();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Blog</h1>
        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/dashboard/blog/authors">
            Authors
          </Link>
          <Link
            className="rounded-md bg-brand px-4 py-2 font-medium text-brand-contrast"
            href="/dashboard/blog/edit"
          >
            New post
          </Link>
        </div>
      </div>
      <Card title="Posts">
        {rows.length === 0 ? <p className="text-sm text-muted">No posts yet.</p> : null}
        <Table head={["Title", "Status", "Author", "Updated", ""]}>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-line" data-testid="blog-row">
              <td className="px-3 py-2">
                <Link className="underline" href={`/dashboard/blog/edit?id=${p.id}`}>
                  {p.title}
                </Link>
              </td>
              <td className="px-3 py-2">{p.status === "published" ? "Published" : "Draft"}</td>
              <td className="px-3 py-2">{p.author ?? "—"}</td>
              <td className="px-3 py-2">{p.updatedAt.toISOString().slice(0, 10)}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-3">
                  {p.status === "published" ? (
                    <>
                      <Link className="text-sm underline" href={`/blog/${p.slug}`}>
                        View
                      </Link>
                      <form action={unpublishPost}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-sm underline" type="submit">
                          Unpublish
                        </button>
                      </form>
                    </>
                  ) : (
                    <form action={publishPost}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-sm underline" type="submit">
                        Publish
                      </button>
                    </form>
                  )}
                  <form action={deletePostAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-sm text-danger" type="submit">
                      Delete
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

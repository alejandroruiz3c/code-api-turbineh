import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { requireAdmin } from "@/server/admin";
import { deletePost, savePost } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const area = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export default async function Posts({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const editId = (await searchParams).edit;
  const editing =
    typeof editId === "string" && /^[0-9a-f-]{36}$/.test(editId)
      ? ((await db.select().from(posts).where(eq(posts.id, editId)))[0] ?? null)
      : null;
  const rows = await db.select().from(posts).orderBy(desc(posts.createdAt)).limit(100);
  return (
    <div className="flex flex-col gap-6">
      <Card title={editing ? "Edit post" : "New post"}>
        <form action={savePost} className="flex flex-col gap-4">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div>
            <Label htmlFor="p-title">Title</Label>
            <Input
              id="p-title"
              name="title"
              defaultValue={editing?.title}
              required
              maxLength={160}
            />
          </div>
          <div>
            <Label htmlFor="p-excerpt">Summary</Label>
            <Input
              id="p-excerpt"
              name="excerpt"
              defaultValue={editing?.excerpt}
              required
              maxLength={300}
            />
          </div>
          <div>
            <Label htmlFor="p-body">
              Text (Markdown: # headings, **bold**, - lists, [links](https://…))
            </Label>
            <textarea
              id="p-body"
              name="body"
              defaultValue={editing?.body}
              required
              rows={12}
              className={area}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="published" defaultChecked={editing?.published ?? false} />{" "}
            Published
          </label>
          <div>
            <Button type="submit">{editing ? "Save changes" : "Create post"}</Button>
          </div>
        </form>
      </Card>
      <Card title="Posts">
        <Table head={["Title", "Status", "Updated", ""]}>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="px-3 py-2">
                <Link className="underline" href={`/dashboard/posts?edit=${p.id}`}>
                  {p.title}
                </Link>
              </td>
              <td className="px-3 py-2">{p.published ? "Published" : "Draft"}</td>
              <td className="px-3 py-2">{p.updatedAt.toISOString().slice(0, 10)}</td>
              <td className="px-3 py-2 text-right">
                <form action={deletePost}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-sm text-red-600" type="submit">
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

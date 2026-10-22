import { listAuthors } from "@/blog/posts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { requireAdmin } from "@/server/authz";
import { deleteAuthorAction, saveAuthorAction } from "../actions";

/** Blog authors (staff): name and bio shown on each author's public page. */
export default async function Authors() {
  await requireAdmin();
  const authors = await listAuthors();
  return (
    <div className="flex flex-col gap-6">
      <Card title="New author">
        <form action={saveAuthorAction} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="a-name">Name</Label>
            <Input id="a-name" name="name" required minLength={2} maxLength={120} />
          </div>
          <div>
            <Label htmlFor="a-bio">Bio</Label>
            <textarea
              id="a-bio"
              name="bio"
              rows={3}
              maxLength={1000}
              className="w-full rounded-md border border-field bg-surface px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Button type="submit">Add author</Button>
          </div>
        </form>
      </Card>
      <Card title="Authors">
        <Table head={["Name", "Page", ""]}>
          {authors.map((a) => (
            <tr key={a.id} className="border-b border-line">
              <td className="px-3 py-2">{a.name}</td>
              <td className="px-3 py-2">/blog/author/{a.slug}</td>
              <td className="px-3 py-2 text-right">
                <form action={deleteAuthorAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="text-sm text-danger" type="submit">
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

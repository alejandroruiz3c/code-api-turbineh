import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryForm } from "@/components/site-pages/entry-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { requireAdmin } from "@/server/authz";
import { collectionOf } from "@/site-pages/config";
import { allEntries } from "@/site-pages/service";
import { deleteSiteEntry } from "../actions";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ collection: string }> };

/** Entries of one public collection for staff: drafts and published, add, edit, delete. */
export default async function CollectionAdmin({ params }: Props) {
  await requireAdmin();
  const c = collectionOf((await params).collection);
  if (!c) notFound();
  const rows = await allEntries(c);
  return (
    <div className="flex flex-col gap-6">
      <Card title={c.plural}>
        <Table head={["Title", "Status", ...c.filters.map((f) => f.label), ""]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line" data-testid="site-entry-row">
              <td className="px-3 py-2">
                <Link href={`/dashboard/site-pages/${c.key}/${r.id}`} className="underline">
                  {r.title}
                </Link>
              </td>
              <td className="px-3 py-2">{r.published ? "Published" : "Draft"}</td>
              {c.filters.map((f) => (
                <td key={f.key} className="px-3 py-2">
                  {r.attributes[f.key] ?? ""}
                </td>
              ))}
              <td className="px-3 py-2">
                <form action={deleteSiteEntry}>
                  <input type="hidden" name="collection" value={c.key} />
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" className="bg-subtle px-2 py-1 text-xs text-ink">
                    Delete
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-sm">
          <Link href={c.path} className="text-accent underline">
            See the public page
          </Link>
        </p>
      </Card>
      <Card title={`New ${c.label.toLowerCase()}`}>
        <EntryForm c={c} />
      </Card>
    </div>
  );
}

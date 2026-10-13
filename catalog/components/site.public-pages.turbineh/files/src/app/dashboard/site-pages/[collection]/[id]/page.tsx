import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EntryForm } from "@/components/site-pages/entry-form";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/server/authz";
import { collectionOf } from "@/site-pages/config";
import { entryById } from "@/site-pages/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ collection: string; id: string }> };

/** Edit one public entry (staff). */
export default async function EntryAdmin({ params }: Props) {
  await requireAdmin();
  const { collection, id } = await params;
  const c = collectionOf(collection);
  if (!c || !z.uuid().safeParse(id).success) notFound();
  const entry = await entryById(c, id);
  if (!entry) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/dashboard/site-pages/${c.key}`} className="text-sm text-accent underline">
        ← {c.plural}
      </Link>
      <Card title={entry.title}>
        <EntryForm c={c} entry={entry} />
      </Card>
    </div>
  );
}

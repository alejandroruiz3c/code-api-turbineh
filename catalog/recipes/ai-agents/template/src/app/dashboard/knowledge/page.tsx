import { count, desc, eq } from "drizzle-orm";
import { KnowledgeForm } from "@/components/knowledge-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { chunks, documents } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { deleteDocument } from "./actions";

export default async function Knowledge() {
  const ctx = await requireMember();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      chars: documents.chars,
      createdAt: documents.createdAt,
      parts: count(chunks.id),
    })
    .from(documents)
    .leftJoin(chunks, eq(chunks.documentId, documents.id))
    .where(eq(documents.organizationId, ctx.organizationId))
    .groupBy(documents.id)
    .orderBy(desc(documents.createdAt));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <p className="text-sm text-slate-600">
        Assistants answer from these documents and cite them. Documents are data for the assistant:
        instructions written inside them are ignored.
      </p>
      {can(ctx.role, "create") ? (
        <Card title="Add a document">
          <KnowledgeForm />
        </Card>
      ) : null}
      <Table head={["Title", "Size", "Passages", ""]}>
        {rows.map((d) => (
          <tr key={d.id} data-document={d.title}>
            <td className="px-3 py-2">{d.title}</td>
            <td className="px-3 py-2">{d.chars.toLocaleString("en")} characters</td>
            <td className="px-3 py-2">{d.parts}</td>
            <td className="px-3 py-2">
              {can(ctx.role, "delete") ? (
                <form action={deleteDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button type="submit" className="bg-red-700">
                    Delete
                  </Button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

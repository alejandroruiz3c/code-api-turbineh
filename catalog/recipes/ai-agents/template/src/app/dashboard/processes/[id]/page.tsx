import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { processes, processItems } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { addItems, deleteProcess, runNow } from "../actions";

export default async function ProcessPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [proc] = await db
    .select()
    .from(processes)
    .where(and(eq(processes.id, id.data), eq(processes.organizationId, ctx.organizationId)));
  if (!proc) notFound();
  const items = await db
    .select()
    .from(processItems)
    .where(eq(processItems.processId, proc.id))
    .orderBy(asc(processItems.updatedAt))
    .limit(500);
  const queued = items.filter((i) => i.status === "queued").length;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{proc.name}</h1>
      <p className="text-sm text-slate-600">
        {proc.instruction}
        {proc.labels.length > 0 ? ` · Labels: ${proc.labels.join(", ")}` : ""}
      </p>
      {can(ctx.role, "create") ? (
        <Card title="Add items">
          <form action={addItems} className="flex flex-col gap-3">
            <input type="hidden" name="processId" value={proc.id} />
            <div>
              <Label htmlFor="pi-items">One item per line</Label>
              <textarea
                id="pi-items"
                name="items"
                rows={5}
                className="w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pi-file">Or a CSV file (first column)</Label>
              <input id="pi-file" name="file" type="file" accept=".csv,text/csv" />
            </div>
            <div>
              <Button type="submit">Add items</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <div className="flex items-center gap-3">
        <form action={runNow}>
          <input type="hidden" name="processId" value={proc.id} />
          <Button type="submit" disabled={queued === 0}>
            Run now
          </Button>
        </form>
        <span className="text-sm text-slate-600">{queued} queued</span>
        <a className="text-sm underline" href={`/dashboard/processes/${proc.id}/export`}>
          Export CSV
        </a>
      </div>
      <Table head={["Item", "Status", "Result"]}>
        {items.map((i) => (
          <tr key={i.id} data-item={i.input.slice(0, 60)}>
            <td className="px-3 py-2">{i.input.slice(0, 200)}</td>
            <td className="px-3 py-2">{i.status}</td>
            <td className="px-3 py-2">{i.output ?? ""}</td>
          </tr>
        ))}
      </Table>
      {can(ctx.role, "update") ? (
        <form action={deleteProcess}>
          <input type="hidden" name="processId" value={proc.id} />
          <Button type="submit" className="bg-red-700">
            Delete process
          </Button>
        </form>
      ) : null}
    </div>
  );
}

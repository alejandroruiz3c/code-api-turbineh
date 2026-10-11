import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { requestFiles, requests } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { canTransition, isStatus, nextStatuses, seesAll, STATUS_LABEL } from "@/server/portal";
import { changeStatus, uploadFile } from "../actions";

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, id), eq(requests.organizationId, ctx.organizationId)));
  if (!row || (!seesAll(ctx.role) && row.createdBy !== ctx.userId)) notFound();
  const files = await db
    .select({
      id: requestFiles.id,
      fileName: requestFiles.fileName,
      size: requestFiles.size,
      createdAt: requestFiles.createdAt,
    })
    .from(requestFiles)
    .where(eq(requestFiles.requestId, id))
    .orderBy(desc(requestFiles.createdAt));
  const status = isStatus(row.status) ? row.status : "submitted";
  const moves = nextStatuses(status).filter((s) => canTransition(ctx.role, status, s));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{row.title}</h1>
      <Card title="Request">
        <p className="whitespace-pre-wrap text-sm">{row.description}</p>
        <p className="mt-4 text-sm">
          Status: <strong data-testid="request-status">{STATUS_LABEL[status]}</strong>
        </p>
        {moves.length > 0 ? (
          <form action={changeStatus} className="mt-4 flex items-center gap-2">
            <input type="hidden" name="requestId" value={row.id} />
            <label htmlFor="rq-status" className="text-sm">
              Move to
            </label>
            <select
              id="rq-status"
              name="status"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {moves.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <Button type="submit">Update status</Button>
          </form>
        ) : null}
      </Card>
      <Card title={`Files (${files.length})`}>
        {status !== "completed" ? (
          <form action={uploadFile} className="mb-4 flex items-end gap-3">
            <input type="hidden" name="requestId" value={row.id} />
            <div>
              <label htmlFor="rq-file" className="block text-sm font-medium">
                File (PDF, PNG, JPEG, WebP or text, up to 5 MB)
              </label>
              <input id="rq-file" name="file" type="file" required />
            </div>
            <Button type="submit">Upload</Button>
          </form>
        ) : null}
        <Table head={["File", "Size", "Uploaded"]}>
          {files.map((f) => (
            <tr key={f.id} className="border-b border-slate-100">
              <td className="px-3 py-2">
                <a className="underline" href={`/dashboard/requests/${row.id}/files/${f.id}`}>
                  {f.fileName}
                </a>
              </td>
              <td className="px-3 py-2">{kb(f.size)}</td>
              <td className="px-3 py-2">{f.createdAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { requestFiles, requests } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { seesAll } from "@/server/portal";

const UUID = /^[0-9a-f-]{36}$/;

/** Download: same visibility rule as the request; always an attachment, never rendered inline. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; fileId: string }> },
): Promise<Response> {
  const member = await requireMember();
  const { id, fileId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(fileId)) return new Response("Not found", { status: 404 });
  const [row] = await db
    .select({
      createdBy: requests.createdBy,
      fileName: requestFiles.fileName,
      mime: requestFiles.mime,
      data: requestFiles.data,
    })
    .from(requestFiles)
    .innerJoin(requests, eq(requests.id, requestFiles.requestId))
    .where(
      and(
        eq(requestFiles.id, fileId),
        eq(requestFiles.requestId, id),
        eq(requestFiles.organizationId, member.organizationId),
      ),
    );
  if (!row || (!seesAll(member.role) && row.createdBy !== member.userId)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `attachment; filename="${row.fileName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

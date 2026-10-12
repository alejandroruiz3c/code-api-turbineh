import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { processes, processItems } from "@/db/schema";
import { toCsv } from "@/lib/csv";
import { requireMember } from "@/server/authz";

/** GET /dashboard/processes/{id}/export — results of one process as CSV (formula injection neutralised). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const member = await requireMember();
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  const [proc] = await db
    .select({ id: processes.id, name: processes.name })
    .from(processes)
    .where(and(eq(processes.id, id.data), eq(processes.organizationId, member.organizationId)));
  if (!proc) return new Response("Not found", { status: 404 });
  const rows = await db
    .select({ input: processItems.input, status: processItems.status, output: processItems.output })
    .from(processItems)
    .where(eq(processItems.processId, proc.id))
    .orderBy(asc(processItems.updatedAt));
  return new Response(toCsv(rows, ["input", "status", "output"]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="process-${proc.id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

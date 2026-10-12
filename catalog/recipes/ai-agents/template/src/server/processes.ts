import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { processes, processItems } from "@/db/schema";
import { orchestrate } from "@/lib/ai/orchestrator";
import { toUserMessage } from "@/security/errors";
import { isKind, outputText, PROCESS_TASKS, schemaFor } from "./process-schema";

/**
 * Processes up to `limit` queued items (all workspaces, or one): claimed atomically so several runners never take
 * the same item; every model call goes through the orchestrator; 3 attempts, then the item stays `failed`.
 */
export async function runBatch(limit = 10, organizationId?: string) {
  const take = Math.min(Math.max(limit, 1), 50);
  const claimed = await db.execute<{
    id: string;
    process_id: string;
    input: string;
    attempts: number;
  }>(sql`
    UPDATE process_items SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM process_items
      WHERE status = 'queued' ${organizationId ? sql`AND organization_id = ${organizationId}` : sql.empty()}
      ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT ${take}
    )
    RETURNING id, process_id, input, attempts`);
  const out = { done: 0, retried: 0, failed: 0 };
  for (const item of claimed.rows) {
    const [proc] = await db.select().from(processes).where(eq(processes.id, item.process_id));
    if (!proc || !isKind(proc.kind)) continue;
    try {
      const result = await orchestrate({
        task: `${PROCESS_TASKS[proc.kind]} ${proc.instruction}`.slice(0, 2000),
        input: item.input,
        purpose: `process-${proc.kind}`,
        schema: schemaFor(proc.kind, proc.labels),
        organizationId: proc.organizationId,
        userId: proc.createdBy,
      });
      await db
        .update(processItems)
        .set({
          status: "done",
          output: outputText(proc.kind, result.output),
          updatedAt: new Date(),
        })
        .where(eq(processItems.id, item.id));
      out.done += 1;
    } catch (err) {
      const last = item.attempts >= 3;
      await db
        .update(processItems)
        .set({
          status: last ? "failed" : "queued",
          output: last ? toUserMessage(err) : null,
          updatedAt: new Date(),
        })
        .where(eq(processItems.id, item.id));
      if (last) out.failed += 1;
      else out.retried += 1;
    }
  }
  return out;
}

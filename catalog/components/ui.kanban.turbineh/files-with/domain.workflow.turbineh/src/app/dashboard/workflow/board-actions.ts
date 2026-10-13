"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";
import { transition } from "@/workflow/service";

/**
 * Kanban moves (ui.kanban.turbineh on domain.workflow.turbineh): a card dropped on a column is a workflow transition,
 * re-checked on the server (definition, current state, role) under a row lock and written to the immutable history.
 */
const schema = z.object({ id: z.uuid(), to: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) });

export async function moveCard(id: string, to: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireMember();
  if (!rateLimit(`kanban:move:${ctx.userId}`, 60))
    return { ok: false, message: "Too many moves. Try again in a minute." };
  const parsed = schema.safeParse({ id, to });
  if (!parsed.success) return { ok: false, message: "Invalid move." };
  try {
    await transition(ctx, parsed.data.id, parsed.data.to, null);
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
  revalidatePath("/dashboard/workflow", "layout");
  return { ok: true, message: "Moved." };
}

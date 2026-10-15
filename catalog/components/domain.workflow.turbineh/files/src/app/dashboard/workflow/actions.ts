"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";
import { createItem, transition } from "@/workflow/service";

/** Workflow actions (domain.workflow.turbineh): create a record, move it to another state. Rules in the service. */
export type WorkflowState = { ok: boolean; message: string } | null;

const createSchema = z.object({
  workflow: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  scopeId: z.union([z.uuid(), z.literal("")]).optional(),
  dueAt: z.union([z.iso.date(), z.literal("")]).optional(),
});

export async function createWorkflowItem(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!(await rateLimit(`workflow:create:${ctx.userId}`, 30))) throw new Error("Too many requests");
  const input = createSchema.parse(Object.fromEntries(formData));
  const id = await createItem(ctx, {
    workflow: input.workflow,
    title: input.title,
    description: input.description ?? null,
    scopeId: input.scopeId || null,
    dueAt: input.dueAt ? new Date(`${input.dueAt}T23:59:59Z`) : null,
  });
  revalidatePath(`/dashboard/workflow/${input.workflow}`);
  redirect(`/dashboard/workflow/${input.workflow}/${id}`);
}

const moveSchema = z.object({
  id: z.uuid(),
  to: z.string().min(1).max(40),
  note: z.string().max(500).optional(),
});

/** Moves a record; the reply says why when the definition or the role does not allow it. */
export async function moveWorkflowItem(
  _prev: WorkflowState,
  formData: FormData,
): Promise<WorkflowState> {
  const ctx = await requireMember();
  if (!(await rateLimit(`workflow:move:${ctx.userId}`, 60)))
    return { ok: false, message: "Too many changes. Try again in a minute." };
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid change." };
  try {
    await transition(ctx, parsed.data.id, parsed.data.to, parsed.data.note);
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
  revalidatePath("/dashboard/workflow", "layout");
  return { ok: true, message: "Status changed." };
}

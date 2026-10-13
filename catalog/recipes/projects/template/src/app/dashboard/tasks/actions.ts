"use server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { editableTask } from "@/app/dashboard/projects/actions";
import { db } from "@/db/client";
import { taskComments, tasks } from "@/db/schema";
import { auth } from "@/lib/auth";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import { isPriority, isStatus } from "@/server/board";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(10_000),
  status: z.string().refine(isStatus),
  priority: z.string().refine(isPriority),
  assigneeId: z.string().max(64),
  dueDate: z.iso
    .date()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Task actions: update (status, assignee, priority, due date), delete and comment. */
export async function updateTask(formData: FormData): Promise<void> {
  await requireMember();
  const id = z.uuid().parse(formData.get("id"));
  const { task } = await editableTask(id);
  const input = updateSchema.parse(Object.fromEntries(formData));
  await db
    .update(tasks)
    .set({
      ...input,
      assigneeId: input.assigneeId || null,
      dueDate: input.dueDate ?? null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));
  revalidatePath(`/dashboard/projects/${task.projectId}`);
  revalidatePath(`/dashboard/tasks/${task.id}`);
  revalidatePath("/dashboard/my-tasks");
}

export async function deleteTask(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "delete"))
    throw new UserFacingError("Only owners and admins can delete tasks.");
  const { task } = await editableTask(z.uuid().parse(formData.get("id")));
  await db.delete(tasks).where(eq(tasks.id, task.id));
  revalidatePath(`/dashboard/projects/${task.projectId}`);
  redirect(`/dashboard/projects/${task.projectId}`);
}

export async function addComment(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!rateLimit(`comment:${ctx.userId}`))
    throw new UserFacingError("Too many comments. Try again later.");
  const id = z.uuid().parse(formData.get("taskId"));
  const body = z.string().trim().min(1).max(5000).parse(formData.get("body"));
  const [task] = await db
    .select({ id: tasks.id, org: tasks.organizationId })
    .from(tasks)
    .where(eq(tasks.id, id));
  if (!task || task.org !== ctx.organizationId) throw new UserFacingError("Task not found.");
  const session = await auth.api.getSession({ headers: await headers() });
  await db.insert(taskComments).values({
    organizationId: ctx.organizationId,
    taskId: id,
    authorId: ctx.userId,
    authorName: session?.user.name ?? "Member",
    body,
  });
  revalidatePath(`/dashboard/tasks/${id}`);
}

"use server";
import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import { archiveFlag, isPriority, isStatus, neighbour } from "@/server/board";

const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
});

export async function createProject(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create"))
    throw new UserFacingError("You are not allowed to create projects.");
  const input = projectSchema.parse(Object.fromEntries(formData));
  const [row] = await db
    .insert(projects)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      description: input.description ?? "",
      createdBy: ctx.userId,
    })
    .returning({ id: projects.id });
  revalidatePath("/dashboard/projects");
  if (row) redirect(`/dashboard/projects/${row.id}`);
}

/** Load a project of the active workspace for a change; owners and admins (or its creator) may change it. */
async function requireEditableProject(id: string) {
  const ctx = await requireMember();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.organizationId, ctx.organizationId)));
  if (!project) throw new UserFacingError("Project not found.");
  if (!can(ctx.role, "update") && project.createdBy !== ctx.userId)
    throw new UserFacingError("You can only change your own projects.");
  return { ctx, project };
}

/** Rename a project or change its description. */
export async function updateProject(formData: FormData): Promise<void> {
  await requireMember();
  const { ctx, project } = await requireEditableProject(z.uuid().parse(formData.get("id")));
  if (!(await rateLimit(`update:projects:${ctx.userId}`)))
    throw new UserFacingError("Too many requests. Try again later.");
  const input = projectSchema.parse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
  });
  await db
    .update(projects)
    .set({ name: input.name, description: input.description ?? "" })
    .where(eq(projects.id, project.id));
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${project.id}`);
}

/** Archive a project (it leaves the project list) or restore it. Its tasks are kept. */
export async function setProjectArchived(formData: FormData): Promise<void> {
  await requireMember();
  const { project } = await requireEditableProject(z.uuid().parse(formData.get("id")));
  const archived = archiveFlag(formData.get("action"));
  if (archived === null) throw new UserFacingError("Unknown action.");
  await db.update(projects).set({ archived }).where(eq(projects.id, project.id));
  revalidatePath("/dashboard/projects");
  revalidatePath(`/dashboard/projects/${project.id}`);
  revalidatePath("/dashboard/my-tasks");
}

/** Delete a project with all its tasks and their comments (database cascade). Owners and admins only. */
export async function deleteProject(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "delete"))
    throw new UserFacingError("Only owners and admins can delete projects.");
  const { project } = await requireEditableProject(z.uuid().parse(formData.get("id")));
  await db.delete(projects).where(eq(projects.id, project.id));
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard/my-tasks");
  redirect("/dashboard/projects");
}

const taskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  assigneeId: z.string().max(64).optional(),
  priority: z.string().refine(isPriority).default("medium"),
  dueDate: z.iso
    .date()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function createTask(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to create tasks.");
  if (!(await rateLimit(`create:tasks:${ctx.userId}`)))
    throw new UserFacingError("Too many requests. Try again later.");
  const input = taskSchema.parse(Object.fromEntries(formData));
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, ctx.organizationId)));
  if (!project) throw new UserFacingError("Project not found.");
  const [{ last } = { last: 0 }] = await db
    .select({ last: max(tasks.position) })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.status, "todo")));
  await db.insert(tasks).values({
    organizationId: ctx.organizationId,
    projectId: project.id,
    title: input.title,
    priority: input.priority,
    assigneeId: input.assigneeId || null,
    dueDate: input.dueDate ?? null,
    position: (last ?? 0) + 1,
    createdBy: ctx.userId,
  });
  revalidatePath(`/dashboard/projects/${project.id}`);
}

/** Load a task of the active workspace and check the member may change it. */
export async function editableTask(id: string) {
  const ctx = await requireMember();
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.organizationId, ctx.organizationId)));
  if (!task) throw new UserFacingError("Task not found.");
  // Members change the tasks they created or are assigned to; owners and admins change any task.
  if (!can(ctx.role, "update") && task.createdBy !== ctx.userId && task.assigneeId !== ctx.userId) {
    throw new UserFacingError("You can only change your own tasks.");
  }
  return { ctx, task };
}

export async function moveTask(formData: FormData): Promise<void> {
  await requireMember();
  const id = z.uuid().parse(formData.get("id"));
  const dir = z.enum(["-1", "1"]).parse(formData.get("dir"));
  const { task } = await editableTask(id);
  if (!isStatus(task.status)) return;
  const to = neighbour(task.status, dir === "1" ? 1 : -1);
  if (!to) return;
  const [{ last } = { last: 0 }] = await db
    .select({ last: max(tasks.position) })
    .from(tasks)
    .where(and(eq(tasks.projectId, task.projectId), eq(tasks.status, to)));
  await db
    .update(tasks)
    .set({ status: to, position: (last ?? 0) + 1, updatedAt: new Date() })
    .where(eq(tasks.id, id));
  revalidatePath(`/dashboard/projects/${task.projectId}`);
  revalidatePath("/dashboard/my-tasks");
}

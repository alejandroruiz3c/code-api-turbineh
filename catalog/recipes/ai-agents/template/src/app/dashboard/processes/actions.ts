"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { processes, processItems } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import { isKind, parseLabels } from "@/server/process-schema";
import { runBatch } from "@/server/processes";

const MAX_ITEMS = 500;

async function requireAdmin() {
  const ctx = await requireMember();
  if (!can(ctx.role, "update"))
    throw new UserFacingError("Only owners and admins can manage AI processes.");
  return ctx;
}

async function ownProcess(organizationId: string, id: string) {
  const [proc] = await db
    .select()
    .from(processes)
    .where(and(eq(processes.id, id), eq(processes.organizationId, organizationId)));
  if (!proc) throw new UserFacingError("Process not found.");
  return proc;
}

export async function createProcess(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const input = z
    .object({
      name: z.string().trim().min(2).max(80),
      kind: z.string().refine(isKind),
      instruction: z.string().trim().min(5).max(2000),
      labels: z.string().max(1000).optional(),
    })
    .parse(Object.fromEntries(formData));
  const labels = input.kind === "classify" ? parseLabels(input.labels ?? "") : [];
  if (input.kind === "classify" && labels.length === 0) {
    throw new UserFacingError("Give between 2 and 20 labels separated by commas.");
  }
  const [row] = await db
    .insert(processes)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      kind: input.kind,
      instruction: input.instruction,
      labels,
      createdBy: ctx.userId,
    })
    .returning({ id: processes.id });
  revalidatePath("/dashboard/processes");
  if (row) redirect(`/dashboard/processes/${row.id}`);
}

/** Queues items: one per line of the text box, or the first column of an uploaded CSV. */
export async function addItems(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to add items.");
  const proc = await ownProcess(ctx.organizationId, z.uuid().parse(formData.get("processId")));
  let lines = String(formData.get("items") ?? "").split(/\r?\n/);
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rows = parseCsv(await file.text());
    lines = rows.map((r) => Object.values(r)[0] ?? "");
  }
  const items = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  if (items.length === 0) throw new UserFacingError("Add at least one item.");
  await db.insert(processItems).values(
    items.map((input) => ({
      organizationId: ctx.organizationId,
      processId: proc.id,
      input: input.slice(0, 8000),
      createdBy: ctx.userId,
    })),
  );
  revalidatePath(`/dashboard/processes/${proc.id}`);
}

/** Processes the next queued items of this workspace now (the scheduler also runs them every minute). */
export async function runNow(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to run processes.");
  if (!(await rateLimit(`process-run:${ctx.userId}`, 6)))
    throw new UserFacingError("Too many runs. Try again later.");
  const proc = await ownProcess(ctx.organizationId, z.uuid().parse(formData.get("processId")));
  await runBatch(10, ctx.organizationId);
  revalidatePath(`/dashboard/processes/${proc.id}`);
}

export async function deleteProcess(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const proc = await ownProcess(ctx.organizationId, z.uuid().parse(formData.get("processId")));
  await db.delete(processes).where(eq(processes.id, proc.id));
  revalidatePath("/dashboard/processes");
  redirect("/dashboard/processes");
}

"use server";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { requestFiles, requests } from "@/db/schema";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import {
  canTransition,
  FILE_LIMITS,
  isStatus,
  safeFileName,
  seesAll,
  sniffType,
} from "@/server/portal";

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(5000),
});

export async function createRequest(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create"))
    throw new UserFacingError("You are not allowed to create requests.");
  if (!rateLimit(`create:requests:${ctx.userId}`))
    throw new UserFacingError("Too many requests. Try again later.");
  const input = createSchema.parse(Object.fromEntries(formData));
  const [row] = await db
    .insert(requests)
    .values({ organizationId: ctx.organizationId, createdBy: ctx.userId, ...input })
    .returning({ id: requests.id });
  revalidatePath("/dashboard/requests");
  if (row) redirect(`/dashboard/requests/${row.id}`);
}

/** The request if the member may see it: their own, or any request for owners and admins. */
async function visibleRequest(id: string) {
  const ctx = await requireMember();
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, id), eq(requests.organizationId, ctx.organizationId)));
  if (!row || (!seesAll(ctx.role) && row.createdBy !== ctx.userId))
    throw new UserFacingError("Request not found.");
  return { ctx, row };
}

export async function uploadFile(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = z.uuid().parse(formData.get("requestId"));
  const { row } = await visibleRequest(id);
  if (row.status === "completed") throw new UserFacingError("This request is completed.");
  if (!rateLimit(`upload:${ctx.userId}`, 20))
    throw new UserFacingError("Too many uploads. Try again later.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Choose a file.");
  if (file.size > FILE_LIMITS.maxBytes) throw new UserFacingError("Files can be up to 5 MB.");
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(requestFiles)
    .where(eq(requestFiles.requestId, id));
  if (n >= FILE_LIMITS.maxFilesPerRequest)
    throw new UserFacingError("A request can have up to 10 files.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffType(bytes);
  if (!mime)
    throw new UserFacingError("Only PDF, PNG, JPEG, WebP and plain text files are accepted.");
  await db.insert(requestFiles).values({
    organizationId: ctx.organizationId,
    requestId: id,
    fileName: safeFileName(file.name),
    mime,
    size: bytes.byteLength,
    data: Buffer.from(bytes),
    uploadedBy: ctx.userId,
  });
  revalidatePath(`/dashboard/requests/${id}`);
}

export async function changeStatus(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = z.uuid().parse(formData.get("requestId"));
  const to = String(formData.get("status") ?? "");
  const { row } = await visibleRequest(id);
  if (!isStatus(to) || !isStatus(row.status) || !canTransition(ctx.role, row.status, to)) {
    throw new UserFacingError("That status change is not allowed.");
  }
  await db
    .update(requests)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(requests.id, id), eq(requests.organizationId, ctx.organizationId)));
  revalidatePath(`/dashboard/requests/${id}`);
  revalidatePath("/dashboard/requests");
}

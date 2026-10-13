"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";
import { deleteUpload, saveUpload } from "@/uploads/service";
import { resolveSubject } from "@/uploads/subjects";

/** Upload actions (storage.private-uploads.turbineh): store a file for a record, remove one. Rules in the service. */
export type UploadState = { ok: boolean; message: string } | null;

const target = z.object({
  subjectType: z.string().min(1).max(60),
  subjectId: z.union([z.string().min(1).max(64), z.literal("")]).optional(),
  scopeId: z.union([z.uuid(), z.literal("")]).optional(),
  back: z.string().startsWith("/dashboard").max(200).optional(),
});

export async function uploadFile(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const ctx = await requireMember();
  if (!rateLimit(`uploads:${ctx.userId}`, 30))
    return { ok: false, message: "Too many uploads. Try again in a minute." };
  const parsed = target.safeParse({
    subjectType: formData.get("subjectType"),
    subjectId: formData.get("subjectId") ?? undefined,
    scopeId: formData.get("scopeId") ?? undefined,
    back: formData.get("back") ?? undefined,
  });
  const file = formData.get("file");
  if (!parsed.success) return { ok: false, message: "Invalid upload." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file." };
  try {
    const subjectId = parsed.data.subjectId || null;
    const { scopeId } = await resolveSubject(
      ctx,
      parsed.data.subjectType,
      subjectId,
      parsed.data.scopeId || null,
    );
    await saveUpload(ctx, file, { subjectType: parsed.data.subjectType, subjectId, scopeId });
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
  revalidatePath(parsed.data.back ?? "/dashboard/files");
  return { ok: true, message: `Uploaded ${file.name}.` };
}

export async function removeFile(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = z.uuid().parse(formData.get("id"));
  await deleteUpload(ctx, id);
  const back = z.string().startsWith("/dashboard").max(200).safeParse(formData.get("back"));
  revalidatePath(back.success ? back.data : "/dashboard/files");
}

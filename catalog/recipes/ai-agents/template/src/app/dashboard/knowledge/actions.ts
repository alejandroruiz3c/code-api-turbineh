"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { toUserMessage, UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import { addDocument } from "@/server/knowledge";

export type KnowledgeState = { error: string | null; added: string | null };

const MAX_FILE_BYTES = 1_000_000;

/** Adds pasted text or an uploaded .txt/.md file to the workspace's knowledge base. */
export async function addKnowledge(
  _prev: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const ctx = await requireMember();
  try {
    if (!can(ctx.role, "create"))
      throw new UserFacingError("You are not allowed to add documents.");
    if (!rateLimit(`knowledge:${ctx.userId}`, 10))
      throw new UserFacingError("Too many uploads. Try again later.");
    const title = z.string().trim().min(2).max(160).parse(formData.get("title"));
    let text = String(formData.get("text") ?? "");
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) throw new UserFacingError("Files can be up to 1 MB.");
      if (
        !/\.(txt|md|markdown)$/i.test(file.name) ||
        (await file.slice(0, 1024).text()).includes("\u0000")
      ) {
        throw new UserFacingError("Upload a plain-text (.txt) or Markdown (.md) file.");
      }
      text = await file.text();
    }
    await addDocument(ctx, title, text);
    revalidatePath("/dashboard/knowledge");
    return { error: null, added: title };
  } catch (err) {
    return { error: toUserMessage(err), added: null };
  }
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "delete"))
    throw new UserFacingError("Only owners and admins can delete documents.");
  const id = z.uuid().parse(formData.get("id"));
  await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId)));
  revalidatePath("/dashboard/knowledge");
}

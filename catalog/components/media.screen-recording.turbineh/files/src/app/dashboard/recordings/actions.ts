"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  deleteRecording,
  renameRecording,
  revokeShare,
  shareRecording,
} from "@/recordings/service";
import { toUserMessage } from "@/security/errors";
import { requireMember } from "@/server/authz";

/** Recording actions (media.screen-recording.turbineh): rename, delete, share by link, revoke the link. */
export type RecordingState = { ok: boolean; message: string; link?: string } | null;

const idSchema = z.uuid();

export async function renameAction(
  _prev: RecordingState,
  formData: FormData,
): Promise<RecordingState> {
  const ctx = await requireMember();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Recording not found." };
  try {
    await renameRecording(ctx, id.data, String(formData.get("title") ?? ""));
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
  revalidatePath(`/dashboard/recordings/${id.data}`);
  return { ok: true, message: "Renamed." };
}

export async function shareAction(
  _prev: RecordingState,
  formData: FormData,
): Promise<RecordingState> {
  const ctx = await requireMember();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Recording not found." };
  try {
    const token = await shareRecording(ctx, id.data);
    revalidatePath(`/dashboard/recordings/${id.data}`);
    return {
      ok: true,
      message: "Share link created. Anyone with it can watch.",
      link: `/v/${token}`,
    };
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
}

export async function revokeAction(
  _prev: RecordingState,
  formData: FormData,
): Promise<RecordingState> {
  const ctx = await requireMember();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Recording not found." };
  try {
    await revokeShare(ctx, id.data);
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
  revalidatePath(`/dashboard/recordings/${id.data}`);
  return { ok: true, message: "Share link revoked." };
}

export async function deleteAction(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = idSchema.safeParse(formData.get("id"));
  if (id.success) await deleteRecording(ctx, id.data);
  revalidatePath("/dashboard/recordings");
  redirect("/dashboard/recordings");
}

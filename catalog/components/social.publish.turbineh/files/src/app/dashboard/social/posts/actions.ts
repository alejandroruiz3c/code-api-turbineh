"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { localDateTime, timeZone } from "@/lib/datetime";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";
import { NETWORKS } from "@/social/networks";
import {
  approvePost,
  cancelPost,
  composePosts,
  rejectPost,
  retryPost,
  submitPost,
} from "@/social/posts";

/** Social post actions (social.publish.turbineh): compose, submit, approve, reject, cancel, retry. Rules in the service. */
export type ComposeState = { ok: boolean; message: string; nextKey?: string } | null;

/** A fresh idempotency key for the next composition (the form keeps its key until a post is saved). */
const freshKey = () => randomBytes(16).toString("base64url");

const compose = z.object({
  connectionIds: z.array(z.uuid()).min(1, "Choose at least one connected account.").max(20),
  text: z.string().max(70_000),
  imageUrl: z.union([z.url().max(2048), z.literal("")]).optional(),
  scheduledLocal: localDateTime,
  timeZone,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/),
  intent: z.enum(["draft", "submit"]),
});

export async function composePostsAction(
  _prev: ComposeState,
  formData: FormData,
): Promise<ComposeState> {
  const ctx = await requireMember();
  if (!(await rateLimit(`social:compose:${ctx.userId}`, 30)))
    return { ok: false, message: "Too many posts. Try again in a minute." };
  const parsed = compose.safeParse({
    connectionIds: formData.getAll("connectionIds"),
    text: formData.get("text") ?? "",
    imageUrl: formData.get("imageUrl") ?? "",
    scheduledLocal: formData.get("scheduledLocal"),
    timeZone: formData.get("timeZone") ?? undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    intent: formData.get("intent"),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const versions: Record<string, string> = {};
  for (const n of NETWORKS) {
    const v = formData.get(`version_${n}`);
    if (typeof v === "string" && v.trim()) versions[n] = v.slice(0, 70_000);
  }
  try {
    const r = await composePosts(ctx, {
      ...parsed.data,
      imageUrl: parsed.data.imageUrl || null,
      versions,
    });
    revalidatePath("/dashboard/social/posts");
    if (r.created === 0)
      return {
        ok: true,
        message: "Already saved (same form sent twice): nothing new was created.",
        nextKey: freshKey(),
      };
    const what = {
      draft: "saved as draft",
      pending_approval: "sent for approval",
      scheduled: "scheduled",
    } as Record<string, string>;
    return {
      ok: true,
      message: `${r.created} post(s) ${what[r.status] ?? r.status}.`,
      nextKey: freshKey(),
    };
  } catch (err) {
    return { ok: false, message: toUserMessage(err) };
  }
}

const OPS = {
  submit: submitPost,
  approve: approvePost,
  reject: rejectPost,
  cancel: cancelPost,
  retry: retryPost,
} as const;

export async function postAction(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const op = z
    .enum(["submit", "approve", "reject", "cancel", "retry"])
    .safeParse(formData.get("op"));
  const id = z.uuid().safeParse(formData.get("id"));
  const backParsed = z
    .string()
    .regex(/^\/dashboard\/social\/posts(\/[0-9a-f-]{36})?$/)
    .safeParse(formData.get("back"));
  const back = backParsed.success ? backParsed.data : "/dashboard/social/posts";
  let error: string | null = null;
  if (!op.success || !id.success) error = "Unknown action.";
  else if (!(await rateLimit(`social:post:${ctx.userId}`, 60)))
    error = "Too many actions. Try again in a minute.";
  else {
    try {
      await OPS[op.data](ctx, id.data);
    } catch (err) {
      error = toUserMessage(err);
    }
  }
  revalidatePath("/dashboard/social/posts");
  if (id.success) revalidatePath(`/dashboard/social/posts/${id.data}`);
  redirect(error ? `${back}?${new URLSearchParams({ error })}` : back);
}

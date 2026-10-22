"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toUserMessage } from "@/security/errors";
import { requireSession } from "@/server/authz";

export type AccountState = { error: string | null; saved: boolean };

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

/** Updates the signed-in person's display name (their own account only, through better-auth's updateUser). */
export async function updateAccountName(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  await requireSession();
  const parsed = nameSchema.safeParse({ name: form.get("name") });
  if (!parsed.success) return { error: "Enter a name (1 to 80 characters).", saved: false };
  try {
    await auth.api.updateUser({ headers: await headers(), body: { name: parsed.data.name } });
  } catch (err) {
    return { error: toUserMessage(err), saved: false };
  }
  revalidatePath("/dashboard/account");
  return { error: null, saved: true };
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FINANCE_KINDS } from "@/mail/triage/config";
import { setEntryKind } from "@/mail/triage/service";
import { requireAdmin } from "@/server/authz";

/** Corrects the type of a ledger entry (component ai.mail-triage.turbineh). ADMIN_EMAILS only. */
export async function changeKind(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const kind = z.enum(FINANCE_KINDS).parse(formData.get("kind"));
  await setEntryKind(id, kind, admin.email);
  revalidatePath("/dashboard/finance");
}

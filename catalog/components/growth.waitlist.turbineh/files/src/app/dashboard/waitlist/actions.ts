"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/authz";
import { waitlistConfig as cfg } from "@/waitlist/config";
import { removeSignups } from "@/waitlist/service";

/** Staff removes a waitlist entry (growth.waitlist.turbineh); their referrals stop counting. */
export async function removeSignup(formData: FormData): Promise<void> {
  await requireAdmin();
  if (!cfg.ownerCanRemove) throw new UserFacingError("Removing entries is turned off.");
  await removeSignups([z.uuid().parse(formData.get("id"))]);
  revalidatePath("/dashboard/waitlist");
}

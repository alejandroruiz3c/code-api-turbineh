"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { contactMessages } from "@/db/schema";
import { requireAdmin } from "@/server/admin";

/** Contact messages: mark handled (staff only). */
export async function markHandled(formData: FormData): Promise<void> {
  await requireAdmin();
  await db
    .update(contactMessages)
    .set({ handled: true })
    .where(eq(contactMessages.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/dashboard/messages");
}

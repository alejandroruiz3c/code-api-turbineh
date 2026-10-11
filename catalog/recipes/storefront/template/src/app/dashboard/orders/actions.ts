"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { requireAdmin } from "@/server/admin";

/** Paid orders can be marked fulfilled; pending ones cancelled. Payments themselves are only set by the webhook. */
export async function setOrderStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const to = z.enum(["fulfilled", "cancelled"]).parse(formData.get("status"));
  const from = to === "fulfilled" ? "paid" : "pending";
  await db
    .update(orders)
    .set({ status: to })
    .where(and(eq(orders.id, id), eq(orders.status, from)));
  revalidatePath("/dashboard/orders");
}

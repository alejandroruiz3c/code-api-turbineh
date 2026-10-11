"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { availability } from "@/db/schema";
import { UserFacingError } from "@/security/errors";
import { parseClock } from "@/server/bookings";
import { can, requireMember } from "@/server/authz";

const clockField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.")
  .transform((v) => parseClock(v) ?? 0);

const windowSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    start: clockField,
    end: clockField,
  })
  .refine((w) => w.start < w.end, "The window must end after it starts.");

/** Owners and admins manage opening hours. */
export async function addWindow(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "update"))
    throw new UserFacingError("Only owners and admins can change availability.");
  const days = formData.getAll("weekday").map(String);
  const rows = days.map((weekday) =>
    windowSchema.parse({ weekday, start: formData.get("start"), end: formData.get("end") }),
  );
  if (rows.length === 0) throw new UserFacingError("Choose at least one day.");
  await db.insert(availability).values(
    rows.map((w) => ({
      organizationId: ctx.organizationId,
      weekday: w.weekday,
      startMinute: w.start,
      endMinute: w.end,
    })),
  );
  revalidatePath("/dashboard/availability");
}

export async function removeWindow(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "delete"))
    throw new UserFacingError("Only owners and admins can change availability.");
  const id = z.uuid().parse(formData.get("id"));
  await db
    .delete(availability)
    .where(and(eq(availability.id, id), eq(availability.organizationId, ctx.organizationId)));
  revalidatePath("/dashboard/availability");
}

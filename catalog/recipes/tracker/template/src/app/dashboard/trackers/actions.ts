"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { trackerLogs, trackers } from "@/db/schema";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";

/** The signed-in user's own tracker (never someone else's). */
async function requireOwnTracker(id: string) {
  const ctx = await requireMember();
  const [t] = await db
    .select()
    .from(trackers)
    .where(
      and(
        eq(trackers.id, id),
        eq(trackers.userId, ctx.userId),
        eq(trackers.organizationId, ctx.organizationId),
      ),
    );
  if (!t) throw new UserFacingError("Tracker not found.");
  return { ctx, t };
}

export async function createTracker(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const input = z
    .object({
      name: z.string().trim().min(2).max(80),
      kind: z.enum(["habit", "quantity"]),
      unit: z.string().trim().max(16).optional(),
      // Empty inputs mean "not given" (a habit has no amount goal).
      dailyTarget: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.coerce.number().positive().max(1_000_000).optional(),
      ),
    })
    .parse(Object.fromEntries(formData));
  const target = input.kind === "habit" ? 1 : (input.dailyTarget ?? 1);
  const [row] = await db
    .insert(trackers)
    .values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      name: input.name,
      kind: input.kind,
      unit: input.kind === "habit" ? "" : (input.unit ?? ""),
      dailyTarget: target.toFixed(2),
    })
    .returning({ id: trackers.id });
  revalidatePath("/dashboard/trackers");
  if (row) redirect(`/dashboard/trackers/${row.id}`);
}

export async function logValue(formData: FormData): Promise<void> {
  const { ctx, t } = await requireOwnTracker(z.uuid().parse(formData.get("trackerId")));
  if (!rateLimit(`log:${ctx.userId}`, 60))
    throw new UserFacingError("Too many entries. Try again in a minute.");
  const day = z.iso.date().parse(formData.get("day"));
  const value =
    t.kind === "habit"
      ? 1
      : z.coerce.number().positive().max(1_000_000).parse(formData.get("value"));
  const note = z
    .string()
    .trim()
    .max(200)
    .optional()
    .parse(formData.get("note") || undefined);
  if (t.kind === "habit") {
    const [done] = await db
      .select({ id: trackerLogs.id })
      .from(trackerLogs)
      .where(and(eq(trackerLogs.trackerId, t.id), eq(trackerLogs.day, day)));
    if (done) return;
  }
  await db.insert(trackerLogs).values({
    trackerId: t.id,
    userId: ctx.userId,
    day,
    value: value.toFixed(2),
    note: note ?? null,
  });
  revalidatePath(`/dashboard/trackers/${t.id}`);
  revalidatePath("/dashboard/trackers");
}

export async function deleteTracker(formData: FormData): Promise<void> {
  const { t } = await requireOwnTracker(z.uuid().parse(formData.get("id")));
  await db.delete(trackers).where(eq(trackers.id, t.id));
  revalidatePath("/dashboard/trackers");
  redirect("/dashboard/trackers");
}

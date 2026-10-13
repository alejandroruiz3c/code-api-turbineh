"use server";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { availability, bookings } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { slotProblem, withinAvailability } from "@/server/bookings";
import { can, requireMember } from "@/server/authz";

/** Booking actions: create (conflict-free, within availability, with a confirmation email) and cancel. */
export type BookingState = { ok: boolean; message: string } | null;

// <input type="datetime-local"> has no zone: the app works in UTC and says so in the form.
const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use the date and time picker.")
  .transform((v) => new Date(`${v}:00Z`));

const createSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z
    .email()
    .max(320)
    .transform((v) => v.toLowerCase()),
  startsAt: utc,
  endsAt: utc,
});

export async function createBooking(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create"))
    return { ok: false, message: "You are not allowed to create bookings." };
  if (!rateLimit(`create:bookings:${ctx.userId}`)) {
    return { ok: false, message: "Too many requests. Try again later." };
  }
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Check the name, email and times." };
  const slot = { start: parsed.data.startsAt, end: parsed.data.endsAt };
  const problem = slotProblem(slot);
  if (problem) return { ok: false, message: problem };

  const result = await db.transaction(async (tx) => {
    // One booking decision at a time per workspace: no double booking even with simultaneous requests.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.organizationId}))`);
    const windows = await tx
      .select({
        weekday: availability.weekday,
        startMinute: availability.startMinute,
        endMinute: availability.endMinute,
      })
      .from(availability)
      .where(eq(availability.organizationId, ctx.organizationId));
    if (!withinAvailability(slot, windows)) return "outside" as const;
    const clash = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.organizationId, ctx.organizationId),
          eq(bookings.status, "confirmed"),
          lt(bookings.startsAt, slot.end),
          gt(bookings.endsAt, slot.start),
        ),
      )
      .limit(1);
    if (clash.length > 0) return "taken" as const;
    await tx.insert(bookings).values({
      organizationId: ctx.organizationId,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      startsAt: slot.start,
      endsAt: slot.end,
      createdBy: ctx.userId,
    });
    return "booked" as const;
  });
  if (result === "outside") return { ok: false, message: "That time is outside the availability." };
  if (result === "taken") return { ok: false, message: "That time is already booked." };

  await sendEmail({
    to: parsed.data.customerEmail,
    subject: "Your booking is confirmed",
    text: `Hi ${parsed.data.customerName}, your booking on ${slot.start.toISOString().slice(0, 16).replace("T", " ")} UTC is confirmed.`,
  });
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/calendar");
  return { ok: true, message: "Booking confirmed." };
}

export async function cancelBooking(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = z.uuid().parse(formData.get("id"));
  const [row] = await db
    .select({ createdBy: bookings.createdBy })
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.organizationId, ctx.organizationId)));
  if (!row) throw new UserFacingError("Booking not found.");
  // Members cancel their own bookings; owners and admins can cancel any booking of the workspace.
  if (row.createdBy !== ctx.userId && !can(ctx.role, "update")) {
    throw new UserFacingError("You are not allowed to cancel this booking.");
  }
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, id), eq(bookings.organizationId, ctx.organizationId)));
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/calendar");
}

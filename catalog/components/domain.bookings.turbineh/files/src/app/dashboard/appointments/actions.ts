"use server";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { bookingAppointments, bookingFaq, bookingResources } from "@/db/schema";
import { cancelAppointment, createAppointment, PolicyError } from "@/bookings/service";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/authz";

/** Staff actions (component domain.bookings.turbineh): only emails on ADMIN_EMAILS (deny by default). */

export type StaffState = { error: string | null; done: string | null };

const bookSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  resource: z.string().trim().max(80).optional(),
  service: z.string().trim().max(80).optional(),
  name: z.string().trim().min(2).max(120),
  email: z.email().max(320),
});

/** Staff book on behalf of a person (same availability and double-booking rules as the assistant). */
export async function staffBook(_prev: StaffState, formData: FormData): Promise<StaffState> {
  await requireAdmin();
  const parsed = bookSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the date, time, name and email.", done: null };
  try {
    const b = await createAppointment({ ...parsed.data, via: "staff" });
    revalidatePath("/dashboard/appointments");
    return { error: null, done: `Booked ${b.reference} on ${b.when}.` };
  } catch (err) {
    if (err instanceof PolicyError) return { error: err.message, done: null };
    throw err;
  }
}

/** Staff may cancel at any time (the notice rule applies to the public only). */
export async function staffCancel(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const [a] = await db
    .select({ reference: bookingAppointments.reference, email: bookingAppointments.customerEmail })
    .from(bookingAppointments)
    .where(eq(bookingAppointments.id, id));
  if (!a) throw new UserFacingError("Appointment not found.");
  await cancelAppointment(a.reference, a.email, { byStaff: true });
  revalidatePath("/dashboard/appointments");
}

export async function saveResource(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = z.string().trim().min(1).max(80).parse(formData.get("name"));
  const id = formData.get("id");
  if (id) {
    await db
      .update(bookingResources)
      .set({ name, active: formData.get("active") === "on" })
      .where(eq(bookingResources.id, z.uuid().parse(id)));
  } else {
    const all = await db.select({ id: bookingResources.id }).from(bookingResources).orderBy(asc(bookingResources.sort));
    await db.insert(bookingResources).values({ name, sort: all.length });
  }
  revalidatePath("/dashboard/appointments/settings");
}

export async function saveAnswer(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const answer = z.string().trim().max(1000).parse(formData.get("answer") ?? "");
  await db
    .update(bookingFaq)
    .set({ answer: answer || null, updatedAt: new Date() })
    .where(eq(bookingFaq.id, id));
  revalidatePath("/dashboard/appointments/settings");
}

export async function addQuestion(formData: FormData): Promise<void> {
  await requireAdmin();
  const topic = z.string().trim().min(2).max(120).parse(formData.get("topic"));
  const answer = z.string().trim().max(1000).parse(formData.get("answer") ?? "");
  await db.insert(bookingFaq).values({ topic, answer: answer || null, sort: 1000 }).onConflictDoNothing();
  revalidatePath("/dashboard/appointments/settings");
}

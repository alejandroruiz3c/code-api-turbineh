"use server";
import { z } from "zod";
import { bookingConfig as cfg } from "@/bookings/config";
import { createAppointment, PolicyError } from "@/bookings/service";
import { publicAction } from "@/server/authz";

/** Public booking (domain.bookings.turbineh): anyone books a real free slot; rate-limited and validated first. */
export type BookState = { ok: boolean; message: string; reference?: string } | null;

const schema = z.object({
  service: z.string().trim().min(1).max(80),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // "HH:MM|<team member>" — the time and who offered it on the page; re-checked against real availability.
  slot: z.string().regex(/^\d{2}:\d{2}\|.{1,80}$/),
  name: z.string().trim().min(2).max(120),
  email: z.email().max(320),
  phone: cfg.askPhone
    ? z.string().trim().regex(/^\+?[\d\s().-]{6,30}$/)
    : z.union([z.string().trim().regex(/^\+?[\d\s().-]{6,30}$/), z.literal("")]).optional(),
  website: z.string().max(0).optional(), // honeypot: humans leave it empty
});

export const bookSlot = publicAction(
  "book",
  {
    rateLimit: { limit: 10 },
    schema,
    refuse: (reason): BookState => ({
      ok: false,
      message:
        reason === "rate-limited"
          ? "Too many attempts. Try again in a minute."
          : `Please choose a time and enter your name, a valid email${cfg.askPhone ? " and your phone" : ""}.`,
    }),
  },
  async (input): Promise<BookState> => {
    const [time, resource] = input.slot.split("|") as [string, string];
    try {
      const b = await createAppointment({
        day: input.day,
        time,
        resource,
        service: input.service,
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        via: "public",
      });
      return {
        ok: true,
        reference: b.reference,
        message: `Booked! ${b.service} with ${b.resource} on ${b.when}. Reference ${b.reference}. We sent the confirmation and a cancel link to ${b.email}.`,
      };
    } catch (err) {
      if (err instanceof PolicyError) return { ok: false, message: err.message };
      throw err;
    }
  },
);

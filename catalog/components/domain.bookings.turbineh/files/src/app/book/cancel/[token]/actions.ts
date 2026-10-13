"use server";
import { z } from "zod";
import { cancelByToken } from "@/bookings/manage";
import { PolicyError } from "@/bookings/service";
import { publicAction } from "@/server/authz";

/** Cancel link (domain.bookings.turbineh): whoever holds the emailed link cancels, within the notice policy. */
export type CancelState = { ok: boolean; message: string } | null;

export const cancelBooking = publicAction(
  "cancel-booking",
  {
    rateLimit: { limit: 10 },
    schema: z.object({ token: z.string().regex(/^[\w-]{20,64}$/) }),
    refuse: (reason): CancelState => ({
      ok: false,
      message:
        reason === "rate-limited" ? "Too many attempts. Try again in a minute." : "Invalid link.",
    }),
  },
  async ({ token }): Promise<CancelState> => {
    try {
      const r = await cancelByToken(token);
      return {
        ok: true,
        message: `Booking ${r.reference} on ${r.when} is cancelled. We emailed you a confirmation.`,
      };
    } catch (err) {
      if (err instanceof PolicyError) return { ok: false, message: err.message };
      throw err;
    }
  },
);

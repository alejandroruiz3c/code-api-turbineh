import { z } from "zod";

/**
 * Extension points of the public booking form (component domain.bookings.turbineh). Another component replaces this
 * file through files-with/domain.bookings.turbineh/ to add fields to the form, check them before the booking is made
 * and act once it exists (domain.reminders.turbineh records consent to SMS or WhatsApp reminders here). The defaults
 * add nothing.
 */
export const bookingExtraFields = z.object({});

/** A message for the person when the extra fields are not acceptable (nothing is booked), or null. */
export async function checkBookingExtras(input: Record<string, unknown>): Promise<string | null> {
  void input;
  return null;
}

/** Runs after the booking is created (never undoes it). */
export async function afterBooking(booking: {
  reference: string;
  email: string;
  phone: string | null;
  input: Record<string, unknown>;
}): Promise<void> {
  void booking;
}

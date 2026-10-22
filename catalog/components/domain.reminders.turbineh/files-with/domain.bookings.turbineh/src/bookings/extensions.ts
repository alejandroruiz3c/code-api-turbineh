import { z } from "zod";
import { consentChannels, recordBookingConsent } from "@/reminders/service";

/**
 * Extension points of the public booking form (domain.bookings.turbineh with domain.reminders.turbineh): the reminder
 * consent boxes. SMS and WhatsApp reminders are sent only to people who tick the box for that channel and give a mobile
 * number that can receive them; email reminders need no extra consent (they are part of the booking's service emails).
 */
export const bookingExtraFields = z.object({
  smsReminders: z.literal("on").optional(),
  whatsappReminders: z.literal("on").optional(),
});

const wanted = (input: Record<string, unknown>) =>
  consentChannels().filter((c) => input[`${c.id}Reminders`] === "on");

/** A ticked box needs a mobile number that channel can reach (E.164 with libphonenumber-js). */
export async function checkBookingExtras(input: Record<string, unknown>): Promise<string | null> {
  const phone = typeof input.phone === "string" ? input.phone : "";
  const unreachable = wanted(input).filter((c) => !c.normalize(phone));
  if (unreachable.length === 0) return null;
  return `To get reminders by ${unreachable.map((c) => (c.id === "sms" ? "SMS" : "WhatsApp")).join(" or ")}, enter your mobile number with its country code (for example +34 612 345 678).`;
}

/** Records the consent the person gave, against the booking's reference. */
export async function afterBooking(booking: {
  reference: string;
  email: string;
  phone: string | null;
  input: Record<string, unknown>;
}): Promise<void> {
  await recordBookingConsent({
    reference: booking.reference,
    phone: booking.phone,
    channels: wanted(booking.input).map((c) => c.id),
  });
}

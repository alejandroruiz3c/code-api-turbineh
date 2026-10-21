/**
 * Payment at booking time (extension point of domain.bookings.turbineh): none by default — a public booking is
 * confirmed at once. payments.booking-deposit.turbineh replaces this file (files-with/) to charge a deposit or the full
 * price with Stripe Checkout: the booking is held ("pending_payment") until its signed webhook confirms it, and the
 * time is freed when the payment expires. Apps may implement another payment step here with the same three exports.
 */
export interface HeldBooking {
  id: string;
  reference: string;
  service: string;
  resource: string;
  when: string;
  name: string;
  email: string;
  holdExpiresAt: Date | null;
}

/** Text shown next to the Book button for this service (e.g. "A 10 € deposit is paid by card"), or null. */
export function paymentNote(service: string): string | null {
  void service;
  return null;
}

/** Minutes a booking of this service is held while the customer pays, or null when there is no payment step. */
export function paymentHoldMinutes(service: string): number | null {
  void service;
  return null;
}

/** Starts the payment of a held booking and returns the hosted payment page's URL. */
export async function startPayment(booking: HeldBooking): Promise<string> {
  void booking;
  throw new Error("No payment step is installed");
}

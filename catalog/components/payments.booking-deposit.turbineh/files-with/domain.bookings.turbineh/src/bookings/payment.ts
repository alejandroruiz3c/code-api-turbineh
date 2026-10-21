import { formatMoney } from "@/payments/deposit";
import { dueFor, holdMinutes, startDepositCheckout } from "@/payments/service";

/**
 * Payment at booking time, from payments.booking-deposit.turbineh (replaces the bookings domain's default, which has
 * no payment step): services with an amount due (src/payments/booking-deposit.json) are held "pending_payment" while
 * the customer pays on Stripe Checkout; the signed webhook confirms them, an expired payment frees the time.
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

/** "A deposit of €10.00 is paid by card to confirm the booking." — or null when the service needs no payment. */
export function paymentNote(service: string): string | null {
  const due = dueFor(service);
  if (!due) return null;
  const amount = formatMoney(due.cents, due.currency);
  return due.kind === "deposit"
    ? `A deposit of ${amount} is paid by card to confirm the booking.`
    : `The price (${amount}) is paid by card to confirm the booking.`;
}

/** Minutes the time is held while the customer pays (Checkout lifetime + grace), or null without payment. */
export function paymentHoldMinutes(service: string): number | null {
  return dueFor(service) ? holdMinutes() : null;
}

/** Opens Stripe Checkout for the held booking and returns its hosted page URL. */
export function startPayment(booking: HeldBooking): Promise<string> {
  return startDepositCheckout(booking);
}

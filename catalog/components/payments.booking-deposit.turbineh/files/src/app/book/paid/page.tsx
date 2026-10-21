import type { Metadata } from "next";
import Link from "next/link";
import { bookingConfig as cfg } from "@/bookings/config";
import { formatMoney } from "@/payments/deposit";
import { returnedBooking } from "@/payments/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Booking · ${cfg.business}`, robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Return page after paying a booking on Stripe Checkout (payments.booking-deposit.turbineh). */
export default async function PaidPage({ searchParams }: Props) {
  const q = await searchParams;
  const b = await returnedBooking(one(q.ref), one(q.session_id));
  const box = "rounded-lg border border-line bg-panel p-4 text-sm";
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">{cfg.business}</h1>
      {!b ? (
        <p role="alert" className={`${box} text-danger`}>
          This booking could not be found.
        </p>
      ) : b.status === "confirmed" ? (
        <>
          <p role="status" className={`${box} text-success`} data-testid="booked">
            {`Booked! ${b.service} with ${b.resource} on ${b.when}. Reference ${b.reference}. We sent the confirmation and a cancel link to ${b.email}.`}
          </p>
          <p className="text-sm text-muted" data-testid="paid">
            {`${b.kind === "deposit" ? "Deposit" : "Payment"} received: ${formatMoney(b.amountCents, b.currency)}.`}
          </p>
        </>
      ) : b.status === "pending_payment" ? (
        <>
          {/* The signed webhook confirms the booking; this page checks again every few seconds. */}
          <meta httpEquiv="refresh" content="3" />
          <p role="status" className={box} data-testid="confirming">
            We are confirming your payment for booking {b.reference}. This page updates by itself.
          </p>
        </>
      ) : (
        <p role="alert" className={`${box} text-danger`} data-testid="not-held">
          {b.payment === "refunded"
            ? `The time was no longer held when the payment arrived, so it was refunded. Please book again.`
            : `The payment for booking ${b.reference} was not completed in time, so the time was released. Please book again.`}
        </p>
      )}
      <Link href="/book" className="text-sm underline">
        Back to booking
      </Link>
    </main>
  );
}

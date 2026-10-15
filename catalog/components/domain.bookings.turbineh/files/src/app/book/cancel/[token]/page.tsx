import type { Metadata } from "next";
import Link from "next/link";
import { appointmentByCancelToken } from "@/bookings/manage";
import { bookingConfig as cfg } from "@/bookings/config";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `Cancel a booking · ${cfg.business}`,
  robots: { index: false },
};

type Props = { params: Promise<{ token: string }> };

/** Cancel link from the confirmation email (domain.bookings.turbineh): shows the booking and the notice policy. */
export default async function CancelPage({ params }: Props) {
  const { token } = await params;
  const a = await appointmentByCancelToken(token);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold">Cancel your booking</h1>
      {!a ? (
        <p role="alert" className="text-sm text-danger">
          This link is not valid.
        </p>
      ) : (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-6">
          <p className="text-sm">
            <strong>{a.service}</strong> with {a.resource} on {a.when} · reference{" "}
            <span className="font-mono">{a.reference}</span>
          </p>
          {a.status !== "confirmed" ? (
            <p role="status" className="text-sm text-muted">
              This booking is cancelled.
            </p>
          ) : a.canCancel ? (
            <CancelForm token={token} />
          ) : (
            <p role="alert" className="text-sm text-danger" data-testid="too-late">
              Bookings can only be cancelled online up to {cfg.policy.cancelNoticeHours} hours
              before they start. Please contact {cfg.business} directly.
            </p>
          )}
        </section>
      )}
      <Link href="/book" className="text-sm text-accent underline">
        Book another time
      </Link>
    </main>
  );
}

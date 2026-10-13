import type { Metadata } from "next";
import Link from "next/link";
import { waitlistConfig as cfg } from "@/waitlist/config";
import { status } from "@/waitlist/service";
import { ConfirmButton } from "./confirm-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your place on the waitlist", robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

/** Confirmation and status link (growth.waitlist.turbineh): confirm the email, then see the position and referral link. */
export default async function WaitlistStatus({ params }: Props) {
  const { token } = await params;
  const s = await status(token);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-20 text-center">
      <h1 className="text-3xl font-bold">Your place on the waitlist</h1>
      {!s ? (
        <p role="alert" className="text-danger">
          This link is not valid.
        </p>
      ) : !s.confirmed ? (
        <div className="flex flex-col items-center gap-3">
          <p>Hi {s.name}, confirm your email to keep your place.</p>
          <ConfirmButton token={token} />
        </div>
      ) : (
        <section className="flex flex-col items-center gap-4 rounded-lg border border-line bg-panel p-6">
          <p className="text-success">You&apos;re confirmed, {s.name}.</p>
          {cfg.showPosition && s.position ? (
            <p className="text-2xl font-semibold">
              You are <span data-testid="position">#{s.position}</span> of {s.total}
            </p>
          ) : null}
          {s.referralLink ? (
            <div className="flex w-full flex-col gap-2">
              <label htmlFor="referral-link" className="text-sm text-muted">
                Your referral link
                {cfg.referral.boost > 0
                  ? ` — every friend who confirms moves you up ${cfg.referral.boost} ${cfg.referral.boost === 1 ? "place" : "places"}`
                  : ""}
              </label>
              <input
                id="referral-link"
                readOnly
                value={s.referralLink}
                className="w-full rounded-md border border-field px-3 py-2 text-center text-sm"
              />
              <p className="text-sm text-muted" data-testid="referrals">
                Confirmed referrals: {s.referrals}
              </p>
            </div>
          ) : null}
        </section>
      )}
      <Link href="/" className="text-sm text-accent underline">
        Back to the home page
      </Link>
    </main>
  );
}

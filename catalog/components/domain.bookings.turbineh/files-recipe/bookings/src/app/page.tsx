import Link from "next/link";
import { BRAND } from "@/brand";
import { bookingConfig as cfg, hoursText, priceLabel } from "@/bookings/config";

/** Public home page of a booking site (domain.bookings.turbineh on recipe bookings): services, hours, book online. */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-20">
      <header className="flex flex-col items-center gap-4 text-center">
        {BRAND.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
          <img src={BRAND.logo} alt="" className="h-16 w-auto" />
        ) : null}
        <h1 className="text-4xl font-bold">{cfg.business}</h1>
        <p className="text-muted">
          Book online with any of our {cfg.resource.count} {cfg.resource.plural.toLowerCase()} in a few clicks.
        </p>
        <div className="flex gap-3">
          <Link className="rounded-md bg-brand px-5 py-2 font-medium text-brand-contrast" href="/book">
            Book now
          </Link>
          <Link className="rounded-md border border-field px-5 py-2" href="/sign-in">
            Staff sign in
          </Link>
        </div>
      </header>
      <section aria-label="Services" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cfg.services.map((s) => (
          <Link
            key={s.name}
            href={`/book?${new URLSearchParams({ service: s.name })}`}
            className="rounded-lg border border-line bg-panel p-4 hover:bg-subtle"
          >
            <div className="font-semibold">{s.name}</div>
            <div className="text-sm text-muted">
              {s.minutes} min{priceLabel(s) ? ` · ${priceLabel(s)}` : ""}
            </div>
          </Link>
        ))}
      </section>
      <section aria-label="Opening hours" className="text-center text-sm text-muted">
        <h2 className="mb-1 font-semibold text-ink">Opening hours</h2>
        <p>{hoursText()}</p>
        <p>Times in {cfg.timeZone}. Cancel online up to {cfg.policy.cancelNoticeHours} hours before.</p>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { bookingConfig as cfg, hoursText, priceLabel } from "@/bookings/config";
import { availability, listResources, PolicyError } from "@/bookings/service";
import { addDays, isDay, localDay } from "@/bookings/time";
import { BookForm } from "./book-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `Book · ${cfg.business}`,
  description: `Book online at ${cfg.business}: pick a service, a ${cfg.resource.singular.toLowerCase()} and a free time.`,
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Public booking page (domain.bookings.turbineh): service, team member or any, a real free time, no account. */
export default async function BookPage({ searchParams }: Props) {
  const q = await searchParams;
  const resources = await listResources();
  const today = localDay(new Date(), cfg.timeZone);
  const service = cfg.services.find((s) => s.name === one(q.service)) ?? cfg.services[0]!;
  const resource = resources.find((r) => r.name === one(q.resource))?.name ?? "";
  const day = isDay(one(q.day)) ? one(q.day) : "";
  let slots: { time: string; resource: string }[] = [];
  let problem: string | null = null;
  if (day) {
    try {
      const a = await availability({ day, service: service.name, resource: resource || undefined });
      // One choice per start time: the first free team member when "any" was chosen.
      const seen = new Set<string>();
      slots = a.slots
        .filter((s) => (resource ? true : !seen.has(s.time) && (seen.add(s.time), true)))
        .map((s) => ({ time: s.time, resource: s.resource }));
      if (slots.length === 0) problem = "There are no free times that day. Please choose another day.";
    } catch (err) {
      if (!(err instanceof PolicyError)) throw err;
      problem = err.message;
    }
  }
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-accent underline">
          ← {cfg.business}
        </Link>
        <h1 className="text-3xl font-bold">Book at {cfg.business}</h1>
        <p className="text-sm text-muted">
          {hoursText()} · times in {cfg.timeZone}
        </p>
      </header>
      <section aria-label="Services" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cfg.services.map((s) => (
          <div key={s.name} className="rounded-lg border border-line bg-panel p-4">
            <div className="font-semibold">{s.name}</div>
            <div className="text-sm text-muted">
              {s.minutes} min{priceLabel(s) ? ` · ${priceLabel(s)}` : ""}
            </div>
          </div>
        ))}
      </section>
      <form method="get" className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-4" aria-label="Find a time">
        <div className="flex flex-col gap-1">
          <label htmlFor="book-service" className="text-sm font-medium text-muted">
            Service
          </label>
          <select id="book-service" name="service" defaultValue={service.name} className="rounded-md border border-field px-3 py-2 text-sm">
            {cfg.services.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.minutes} min)
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="book-resource" className="text-sm font-medium text-muted">
            {cfg.resource.singular}
          </label>
          <select id="book-resource" name="resource" defaultValue={resource} className="rounded-md border border-field px-3 py-2 text-sm">
            <option value="">Any {cfg.resource.singular.toLowerCase()}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="book-day" className="text-sm font-medium text-muted">
            Day
          </label>
          <input
            id="book-day"
            name="day"
            type="date"
            required
            min={today}
            max={addDays(today, cfg.policy.horizonDays)}
            defaultValue={day}
            className="rounded-md border border-field px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast">
            Show free times
          </button>
        </div>
      </form>
      {problem ? (
        <p role="alert" className="text-sm text-danger" data-testid="no-slots">
          {problem}
        </p>
      ) : null}
      {day && slots.length ? (
        <BookForm
          key={`${service.name}|${resource}|${day}`}
          service={service.name}
          day={day}
          slots={slots}
          askPhone={cfg.askPhone}
          noticeHours={cfg.policy.cancelNoticeHours}
        />
      ) : null}
    </main>
  );
}

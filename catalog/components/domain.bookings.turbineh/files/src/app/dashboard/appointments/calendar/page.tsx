import Link from "next/link";
import { bookingConfig as cfg } from "@/bookings/config";
import { calendar, type CalendarEntry } from "@/bookings/manage";
import { addDays, isDay, isoWeekday, localDay } from "@/bookings/time";
import { currentAdmin, requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Entry({ e }: { e: CalendarEntry }) {
  const body = (
    <>
      <span className="font-mono">
        {e.start}–{e.end}
      </span>{" "}
      {e.title}
    </>
  );
  return (
    <li
      data-testid="calendar-entry"
      data-kind={e.kind}
      data-reference={e.reference ?? undefined}
      className={`rounded-md border px-2 py-1 text-xs ${e.kind === "time-off" ? "border-line bg-subtle text-muted" : "border-line bg-surface"}`}
    >
      {e.kind === "booking" ? (
        <Link href={`/dashboard/appointments/${e.id}`} className="underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** Staff calendar (domain.bookings.turbineh): day or week, per team member, bookings and time off. */
export default async function CalendarPage({ searchParams }: Props) {
  await requireMember();
  if (!(await currentAdmin())) return <p role="status">Only staff can see the calendar.</p>;
  const q = await searchParams;
  const view = one(q.view) === "week" ? "week" : "day";
  const today = localDay(new Date(), cfg.timeZone);
  const date = isDay(one(q.date)) ? one(q.date) : today;
  // Week view starts on Monday.
  const from = view === "week" ? addDays(date, 1 - isoWeekday(date)) : date;
  const days = view === "week" ? 7 : 1;
  const { resources, entries } = await calendar(from, days, one(q.resource) || undefined);
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const link = (params: Record<string, string>) =>
    `/dashboard/appointments/calendar?${new URLSearchParams({ view, date, ...params })}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <nav aria-label="Calendar view" className="flex flex-wrap gap-2 text-sm">
          <Link className="underline" href={link({ date: addDays(from, -days) })}>
            ← Previous
          </Link>
          <Link className="underline" href={link({ date: today })}>
            Today
          </Link>
          <Link className="underline" href={link({ date: addDays(from, days) })}>
            Next →
          </Link>
          <Link className={view === "day" ? "font-semibold" : "underline"} href={link({ view: "day" })}>
            Day
          </Link>
          <Link className={view === "week" ? "font-semibold" : "underline"} href={link({ view: "week" })}>
            Week
          </Link>
        </nav>
      </div>
      <p className="text-sm text-muted" data-testid="calendar-range">
        {view === "week" ? `Week of ${from}` : `${DAY_NAMES[isoWeekday(from) - 1]} ${from}`} · {cfg.timeZone}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="px-2 py-2 font-medium text-muted">{cfg.resource.singular}</th>
              {dayList.map((d) => (
                <th key={d} className="px-2 py-2 font-medium text-muted">
                  {DAY_NAMES[isoWeekday(d) - 1]} {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id} className="border-b border-line align-top" data-testid="calendar-row" data-resource={r.name}>
                <th scope="row" className="px-2 py-2 font-medium">
                  {r.name}
                </th>
                {dayList.map((d) => (
                  <td key={d} className="px-2 py-2">
                    <ul className="flex flex-col gap-1">
                      {entries
                        .filter((e) => e.resourceId === r.id && e.day === d)
                        .map((e) => (
                          <Entry key={`${e.kind}-${e.id}`} e={e} />
                        ))}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

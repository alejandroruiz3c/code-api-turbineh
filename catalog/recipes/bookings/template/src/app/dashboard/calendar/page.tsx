import { and, asc, eq, gte, lt } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { bookings } from "@/db/schema";
import { requireMember } from "@/server/authz";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DAY = 86_400_000;
const hm = (d: Date) => d.toISOString().slice(11, 16);

/** Seven-day agenda (UTC) of confirmed bookings, starting today or at ?from=YYYY-MM-DD. */
export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMember();
  const raw = (await searchParams).from;
  const fromParam = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  const from = new Date(`${fromParam ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const to = new Date(from.getTime() + 7 * DAY);
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, ctx.organizationId),
        eq(bookings.status, "confirmed"),
        gte(bookings.startsAt, from),
        lt(bookings.startsAt, to),
      ),
    )
    .orderBy(asc(bookings.startsAt));
  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <nav aria-label="Weeks" className="flex gap-3 text-sm">
          <Link href={`/dashboard/calendar?from=${iso(new Date(from.getTime() - 7 * DAY))}`}>
            Previous week
          </Link>
          <Link href={`/dashboard/calendar?from=${iso(to)}`}>Next week</Link>
        </nav>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {days.map((d) => {
          const today = rows.filter((b) => iso(b.startsAt) === iso(d));
          return (
            <Card
              key={iso(d)}
              title={`${d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${iso(d)}`}
            >
              {today.length === 0 ? (
                <p className="text-sm text-slate-500">No bookings</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {today.map((b) => (
                    <li key={b.id}>
                      <span className="font-medium">
                        {hm(b.startsAt)}–{hm(b.endsAt)}
                      </span>{" "}
                      {b.customerName}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

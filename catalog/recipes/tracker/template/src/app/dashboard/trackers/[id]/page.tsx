import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { trackerLogs, trackers } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { completion, history, streak, totalsByDay } from "@/server/streaks";
import { deleteTracker, logValue } from "../actions";

const n = (v: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(v);

export default async function TrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t] = await db
    .select()
    .from(trackers)
    .where(
      and(
        eq(trackers.id, id),
        eq(trackers.userId, ctx.userId),
        eq(trackers.organizationId, ctx.organizationId),
      ),
    );
  if (!t) notFound();
  const logs = await db
    .select()
    .from(trackerLogs)
    .where(eq(trackerLogs.trackerId, t.id))
    .orderBy(desc(trackerLogs.day));
  const today = new Date().toISOString().slice(0, 10);
  const target = Number(t.dailyTarget);
  const totals = totalsByDay(logs.map((l) => ({ day: l.day, value: Number(l.value) })));
  const days = history(totals, target, today, 30);
  const week = days.slice(-7).reduce((s, d) => s + Math.round(d.total * 100), 0) / 100;
  const todayTotal = totals.get(today) ?? 0;
  const unit = t.unit ? ` ${t.unit}` : "";
  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/trackers" className="text-sm underline">
        ← My trackers
      </Link>
      <h1 className="text-2xl font-semibold">{t.name}</h1>
      <dl className="grid gap-4 md:grid-cols-4">
        {[
          [
            "Today",
            t.kind === "habit"
              ? todayTotal >= 1
                ? "Done ✓"
                : "Not yet"
              : `${n(todayTotal)} / ${n(target)}${unit}`,
          ],
          ["Streak", `${streak(totals, target, today)} days`],
          [
            "Last 7 days",
            t.kind === "habit"
              ? `${days.slice(-7).filter((d) => d.met).length} / 7`
              : `${n(week)}${unit}`,
          ],
          ["Goal met (30 days)", `${completion(days)}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-panel p-4">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-xl font-semibold" data-stat={label}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <Card title={t.kind === "habit" ? "Check in" : "Log an amount"}>
        <form action={logValue} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="trackerId" value={t.id} />
          <div>
            <Label htmlFor="lg-day">Day</Label>
            <Input id="lg-day" name="day" type="date" defaultValue={today} max={today} required />
          </div>
          {t.kind === "quantity" ? (
            <div>
              <Label htmlFor="lg-value">Amount{unit}</Label>
              <Input id="lg-value" name="value" type="number" step="0.01" min="0.01" required />
            </div>
          ) : null}
          <div>
            <Label htmlFor="lg-note">Note</Label>
            <Input id="lg-note" name="note" maxLength={200} />
          </div>
          <Button type="submit">{t.kind === "habit" ? "Mark as done" : "Add"}</Button>
        </form>
      </Card>
      <Card title="Last 30 days">
        <ol className="grid grid-cols-10 gap-1 md:grid-cols-15" aria-label="Last 30 days">
          {days.map((d) => (
            <li
              key={d.day}
              title={`${d.day}: ${n(d.total)}${unit}`}
              aria-label={`${d.day}: ${d.met ? "goal met" : "goal not met"}`}
              className={`aspect-square rounded ${d.met ? "bg-brand" : d.total > 0 ? "bg-field" : "bg-subtle"}`}
            />
          ))}
        </ol>
      </Card>
      <form action={deleteTracker}>
        <input type="hidden" name="id" value={t.id} />
        <button type="submit" className="text-sm text-danger underline">
          Delete tracker
        </button>
      </form>
    </div>
  );
}

import { and, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { trackerLogs, trackers } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { streak, totalsByDay } from "@/server/streaks";
import { createTracker } from "./actions";

export default async function Trackers() {
  const ctx = await requireMember();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 400 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const mine = await db
    .select()
    .from(trackers)
    .where(and(eq(trackers.userId, ctx.userId), eq(trackers.organizationId, ctx.organizationId)));
  const logs = await db
    .select()
    .from(trackerLogs)
    .where(and(eq(trackerLogs.userId, ctx.userId), gte(trackerLogs.day, since)));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My trackers</h1>
      <ul className="grid gap-4 md:grid-cols-3">
        {mine.map((t) => {
          const totals = totalsByDay(
            logs
              .filter((l) => l.trackerId === t.id)
              .map((l) => ({ day: l.day, value: Number(l.value) })),
          );
          const s = streak(totals, Number(t.dailyTarget), today);
          return (
            <li key={t.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <Link
                href={`/dashboard/trackers/${t.id}`}
                className="text-lg font-semibold hover:underline"
              >
                {t.name}
              </Link>
              <p className="mt-2 text-sm text-slate-600" data-streak={t.name}>
                🔥 {s} day streak
              </p>
            </li>
          );
        })}
      </ul>
      <Card title="New tracker">
        <form action={createTracker} className="grid gap-3 md:grid-cols-5 md:items-end">
          <div className="md:col-span-2">
            <Label htmlFor="tr-name">Name</Label>
            <Input
              id="tr-name"
              name="name"
              required
              maxLength={80}
              placeholder="Drink water, Run, Read…"
            />
          </div>
          <div>
            <Label htmlFor="tr-kind">Type</Label>
            <select
              id="tr-kind"
              name="kind"
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="habit">Habit (done / not done)</option>
              <option value="quantity">Amount per day</option>
            </select>
          </div>
          <div>
            <Label htmlFor="tr-target">Daily goal</Label>
            <Input
              id="tr-target"
              name="dailyTarget"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="e.g. 2"
            />
          </div>
          <div>
            <Label htmlFor="tr-unit">Unit</Label>
            <Input id="tr-unit" name="unit" maxLength={16} placeholder="km, L, €" />
          </div>
          <div className="md:col-span-5">
            <Button type="submit">Create tracker</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

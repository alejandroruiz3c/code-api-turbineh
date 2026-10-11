import { asc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { availability } from "@/db/schema";
import { clock, WEEKDAYS } from "@/server/bookings";
import { can, requireMember } from "@/server/authz";
import { addWindow, removeWindow } from "./actions";

export default async function AvailabilityPage() {
  const ctx = await requireMember();
  const manage = can(ctx.role, "update");
  const rows = await db
    .select()
    .from(availability)
    .where(eq(availability.organizationId, ctx.organizationId))
    .orderBy(asc(availability.weekday), asc(availability.startMinute));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Availability</h1>
      {manage ? (
        <Card title="Add opening hours (UTC)">
          <form action={addWindow} className="flex flex-col gap-4">
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-2 text-sm font-medium">Days</legend>
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" name="weekday" value={i} /> {d}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-4">
              <div>
                <Label htmlFor="av-start">From</Label>
                <Input id="av-start" name="start" type="time" required />
              </div>
              <div>
                <Label htmlFor="av-end">To</Label>
                <Input id="av-end" name="end" type="time" required />
              </div>
            </div>
            <div>
              <Button type="submit">Add hours</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Opening hours">
        <Table head={["Day", "From", "To", ""]}>
          {rows.map((w) => (
            <tr key={w.id} className="border-b border-slate-100">
              <td className="px-3 py-2">{WEEKDAYS[w.weekday] ?? w.weekday}</td>
              <td className="px-3 py-2">{clock(w.startMinute)}</td>
              <td className="px-3 py-2">{clock(w.endMinute)}</td>
              <td className="px-3 py-2 text-right">
                {manage ? (
                  <form action={removeWindow}>
                    <input type="hidden" name="id" value={w.id} />
                    <button className="text-sm text-red-600" type="submit">
                      Remove
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

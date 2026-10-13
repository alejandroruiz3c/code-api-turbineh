import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { bookingConfig as cfg } from "@/bookings/config";
import { upcomingTimeOff } from "@/bookings/manage";
import { listResources } from "@/bookings/service";
import { currentAdmin, requireMember } from "@/server/authz";
import { staffRemoveTimeOff } from "../actions";
import { TimeOffForm } from "../staff-forms";

export const dynamic = "force-dynamic";

/** Time off per team member (domain.bookings.turbineh): blocked times are never offered to customers. */
export default async function TimeOffPage() {
  await requireMember();
  if (!(await currentAdmin())) return <p role="status">Only staff can manage time off.</p>;
  const [resources, rows] = await Promise.all([listResources(), upcomingTimeOff()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Time off</h1>
      <Card title="Block time">
        <TimeOffForm resources={resources} resourceLabel={cfg.resource.singular} />
        <p className="mt-2 text-xs text-muted">Local time ({cfg.timeZone}).</p>
      </Card>
      <Table head={[cfg.resource.singular, "From", "To", "Reason", ""]}>
        {rows.map((r) => (
          <tr key={r.id} data-testid="time-off-row">
            <td className="px-3 py-2">{r.resource}</td>
            <td className="px-3 py-2">{r.from}</td>
            <td className="px-3 py-2">{r.to}</td>
            <td className="px-3 py-2">{r.reason ?? ""}</td>
            <td className="px-3 py-2">
              <form action={staffRemoveTimeOff}>
                <input type="hidden" name="id" value={r.id} />
                <Button type="submit" className="bg-subtle px-2 py-1 text-xs text-ink">
                  Remove
                </Button>
              </form>
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 ? <p className="text-sm text-muted">No time off ahead.</p> : null}
    </div>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";
import { bookingConfig as cfg, hoursText } from "@/bookings/config";
import { staffAppointments } from "@/bookings/service";
import { currentAdmin, requireMember } from "@/server/authz";
import { staffCancel } from "./actions";
import { StaffBookForm } from "./staff-book-form";

export const dynamic = "force-dynamic";

/** Staff view of every appointment (component domain.bookings.turbineh). ADMIN_EMAILS only. */
export default async function Appointments() {
  await requireMember();
  if (!(await currentAdmin())) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <p className="text-muted" role="status">
          Only staff can see appointments. Ask the owner to add your email to ADMIN_EMAILS.
        </p>
      </div>
    );
  }
  const rows = await staffAppointments();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <nav aria-label="Bookings" className="flex gap-3 text-sm">
          <Link className="underline" href="/dashboard/appointments/calendar">
            Calendar
          </Link>
          <Link className="underline" href="/dashboard/appointments/time-off">
            Time off
          </Link>
          <Link className="underline" href="/dashboard/appointments/settings">
            Team and answers
          </Link>
        </nav>
      </div>
      <p className="text-sm text-muted">
        {cfg.business} · {cfg.timeZone} · {hoursText()}
      </p>
      <Table
        head={[
          "When",
          cfg.resource.singular,
          "Service",
          "Name",
          "Email",
          "Status",
          "Reference",
          "Notification",
          "",
        ]}
      >
        {rows.map((r) => (
          <tr key={r.id} data-reference={r.reference}>
            <td className="px-3 py-2">{r.when}</td>
            <td className="px-3 py-2">{r.resource}</td>
            <td className="px-3 py-2">{r.service}</td>
            <td className="px-3 py-2">{r.customerName}</td>
            <td className="px-3 py-2">{r.customerEmail}</td>
            <td className="px-3 py-2">{r.status}</td>
            <td className="px-3 py-2 font-mono">
              <Link className="underline" href={`/dashboard/appointments/${r.id}`}>
                {r.reference}
              </Link>
            </td>
            <td className="px-3 py-2">{r.email}</td>
            <td className="px-3 py-2">
              {r.status === "confirmed" ? (
                <form action={staffCancel}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" className="bg-muted px-2 py-1 text-xs">
                    Cancel
                  </Button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 ? <p className="text-sm text-muted">No appointments yet.</p> : null}
      <h2 className="text-lg font-semibold">Book for someone</h2>
      <StaffBookForm services={cfg.services.map((s) => s.name)} />
    </div>
  );
}

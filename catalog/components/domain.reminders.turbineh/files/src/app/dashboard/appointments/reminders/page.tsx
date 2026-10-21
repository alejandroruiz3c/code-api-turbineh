import Link from "next/link";
import { Table } from "@/components/ui/table";
import { bookingConfig as cfg } from "@/bookings/config";
import { describeLocal } from "@/bookings/time";
import { reminderConfig } from "@/reminders/config";
import { staffReminders } from "@/reminders/service";
import { currentAdmin, requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" } as const;

/** Staff view of appointment reminders (component domain.reminders.turbineh): planned, sent, skipped, failed. */
export default async function Reminders() {
  await requireMember();
  if (!(await currentAdmin())) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Reminders</h1>
        <p className="text-muted" role="status">
          Only staff can see reminders. Ask the owner to add your email to ADMIN_EMAILS.
        </p>
      </div>
    );
  }
  const rows = await staffReminders();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Reminders</h1>
        <Link className="text-sm underline" href="/dashboard/appointments">
          Appointments
        </Link>
      </div>
      <p className="text-sm text-muted" data-testid="reminder-policy">
        {reminderConfig.hoursBefore} hours before each appointment by{" "}
        {reminderConfig.channels.map((c) => CHANNEL_LABEL[c]).join(", ")} · times in {cfg.timeZone}.
        SMS and WhatsApp reminders go only to people who agreed when booking and have not replied
        STOP.
      </p>
      <Table head={["Appointment", "Reference", "Name", "Channel", "Reminder time", "Status", ""]}>
        {rows.map((r) => (
          <tr key={r.key} data-reference={r.reference} data-channel={r.channel}>
            <td className="px-3 py-2">{describeLocal(r.startsAt, cfg.timeZone)}</td>
            <td className="px-3 py-2">{r.reference}</td>
            <td className="px-3 py-2">{r.customerName}</td>
            <td className="px-3 py-2">{CHANNEL_LABEL[r.channel]}</td>
            <td className="px-3 py-2">{describeLocal(r.dueAt, cfg.timeZone)}</td>
            <td className="px-3 py-2" data-testid="reminder-status">
              {r.status}
            </td>
            <td className="px-3 py-2 text-xs text-muted">
              {r.reason ?? ""}
              {r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

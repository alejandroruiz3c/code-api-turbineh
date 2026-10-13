import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { bookingAppointments, bookingResources } from "@/db/schema";
import { bookingConfig as cfg } from "@/bookings/config";
import { listResources } from "@/bookings/service";
import { describeLocal } from "@/bookings/time";
import { currentAdmin, requireMember } from "@/server/authz";
import { staffCancel } from "../actions";
import { MoveBookingForm } from "../staff-forms";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

/** One booking for staff (domain.bookings.turbineh): details, move to another time or person, cancel. */
export default async function AppointmentPage({ params }: Props) {
  await requireMember();
  if (!(await currentAdmin())) return <p role="status">Only staff can see appointments.</p>;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [row] = await db
    .select({ a: bookingAppointments, resource: bookingResources.name })
    .from(bookingAppointments)
    .innerJoin(bookingResources, eq(bookingResources.id, bookingAppointments.resourceId))
    .where(eq(bookingAppointments.id, id))
    .limit(1);
  if (!row) notFound();
  const resources = await listResources();
  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/appointments" className="text-sm text-accent underline">
        ← Appointments
      </Link>
      <Card title={`Booking ${row.a.reference}`}>
        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="booking">
          <dt className="text-muted">When</dt>
          <dd data-testid="booking-when">
            {describeLocal(row.a.startsAt, cfg.timeZone)} ({cfg.timeZone})
          </dd>
          <dt className="text-muted">{cfg.resource.singular}</dt>
          <dd>{row.resource}</dd>
          <dt className="text-muted">Service</dt>
          <dd>{row.a.service}</dd>
          <dt className="text-muted">{cfg.customer.singular}</dt>
          <dd>
            {row.a.customerName} · {row.a.customerEmail}
            {row.a.customerPhone ? ` · ${row.a.customerPhone}` : ""}
          </dd>
          <dt className="text-muted">Status</dt>
          <dd data-testid="booking-status">{row.a.status}</dd>
        </dl>
      </Card>
      {row.a.status === "confirmed" ? (
        <>
          <Card title="Move">
            <MoveBookingForm
              id={row.a.id}
              resources={resources.map((r) => r.name)}
              resourceLabel={cfg.resource.singular}
            />
          </Card>
          <Card title="Cancel">
            <form action={staffCancel}>
              <input type="hidden" name="id" value={row.a.id} />
              <Button type="submit">Cancel booking</Button>
            </form>
            <p className="mt-2 text-xs text-muted">
              The customer is emailed when you move or cancel.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}

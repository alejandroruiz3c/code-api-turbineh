// Server code in the app (e.g. a staff action in src/app/dashboard/appointments/actions.ts).
import { availability, createAppointment } from "@/bookings/service";

export async function bookFirstFreeSlot(day: string, name: string, email: string) {
  const free = await availability({ day }); // real free times: hours, duration, time zone, existing bookings
  const first = free.slots[0];
  if (!first) return null;
  return createAppointment({ day, time: first.time, name, email, via: "staff" });
}

export const example = () => bookFirstFreeSlot("2026-11-02", "Ana García", "ana@example.com");

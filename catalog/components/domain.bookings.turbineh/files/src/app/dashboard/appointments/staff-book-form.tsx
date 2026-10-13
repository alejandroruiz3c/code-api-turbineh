"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { staffBook, type StaffState } from "./actions";

/** Staff booking form: same availability rules as the assistant; refusals are shown as-is. */
export function StaffBookForm({ services }: { services: string[] }) {
  const [state, action, pending] = useActionState<StaffState, FormData>(staffBook, {
    error: null,
    done: null,
  });
  return (
    <form action={action} className="grid max-w-xl grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-day">Date</Label>
        <Input id="sb-day" name="day" type="date" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-time">Time</Label>
        <Input id="sb-time" name="time" type="time" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-service">Service</Label>
        <select id="sb-service" name="service" className="rounded-md border border-slate-300 p-2 text-sm">
          {services.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-resource">With (optional)</Label>
        <Input id="sb-resource" name="resource" placeholder="any" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-name">Full name</Label>
        <Input id="sb-name" name="name" required minLength={2} maxLength={120} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sb-email">Email</Label>
        <Input id="sb-email" name="email" type="email" required maxLength={320} />
      </div>
      <div className="col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Booking…" : "Book"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p role="status" className="text-sm text-green-700">
            {state.done}
          </p>
        ) : null}
      </div>
    </form>
  );
}

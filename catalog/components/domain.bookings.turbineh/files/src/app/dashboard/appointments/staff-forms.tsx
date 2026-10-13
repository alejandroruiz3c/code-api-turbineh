"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { staffAddTimeOff, staffMoveBooking, type StaffState } from "./actions";

/** Staff forms (domain.bookings.turbineh): move a booking, block time off. The server re-checks every rule. */
function Result({ state }: { state: StaffState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p role="status" className="text-sm text-success">
          {state.done}
        </p>
      ) : null}
    </>
  );
}

const select = "rounded-md border border-field p-2 text-sm";

export function MoveBookingForm({
  id,
  resources,
  resourceLabel,
}: {
  id: string;
  resources: string[];
  resourceLabel: string;
}) {
  const [state, action, pending] = useActionState<StaffState, FormData>(staffMoveBooking, {
    error: null,
    done: null,
  });
  return (
    <form action={action} className="grid max-w-xl grid-cols-3 gap-3" aria-label="Move booking">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-1">
        <Label htmlFor="mv-day">New date</Label>
        <Input id="mv-day" name="day" type="date" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mv-time">New time</Label>
        <Input id="mv-time" name="time" type="time" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mv-resource">{resourceLabel}</Label>
        <select id="mv-resource" name="resource" className={select} defaultValue="">
          <option value="">Same or any</option>
          {resources.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="col-span-3 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Move booking
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function TimeOffForm({
  resources,
  resourceLabel,
}: {
  resources: { id: string; name: string }[];
  resourceLabel: string;
}) {
  const [state, action, pending] = useActionState<StaffState, FormData>(staffAddTimeOff, {
    error: null,
    done: null,
  });
  return (
    <form
      action={action}
      className="grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-5"
      aria-label="Add time off"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="to-resource">{resourceLabel}</Label>
        <select id="to-resource" name="resourceId" className={select} required>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to-day">Day</Label>
        <Input id="to-day" name="day" type="date" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to-from">From</Label>
        <Input id="to-from" name="from" type="time" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to-to">To</Label>
        <Input id="to-to" name="to" type="time" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="to-reason">Reason</Label>
        <Input id="to-reason" name="reason" maxLength={120} placeholder="optional" />
      </div>
      <div className="col-span-2 flex items-center gap-3 md:col-span-5">
        <Button type="submit" disabled={pending}>
          Block time
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

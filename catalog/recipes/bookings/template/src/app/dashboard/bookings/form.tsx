"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBooking, type BookingState } from "./actions";

export function BookingForm() {
  const [state, action, pending] = useActionState<BookingState, FormData>(createBooking, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label htmlFor="bk-name">Customer name</Label>
        <Input id="bk-name" name="customerName" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="bk-email">Customer email</Label>
        <Input id="bk-email" name="customerEmail" type="email" required />
      </div>
      <div>
        <Label htmlFor="bk-start">Starts (UTC)</Label>
        <Input id="bk-start" name="startsAt" type="datetime-local" required />
      </div>
      <div>
        <Label htmlFor="bk-end">Ends (UTC)</Label>
        <Input id="bk-end" name="endsAt" type="datetime-local" required />
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Booking…" : "Book"}
        </Button>
        {state ? (
          <p role="status" className={state.ok ? "text-success" : "text-danger"}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

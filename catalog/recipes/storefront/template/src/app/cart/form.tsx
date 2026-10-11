"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkout, type CheckoutState } from "./actions";

export function CheckoutForm() {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkout, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="co-email">Email for your receipt (optional)</Label>
        <Input id="co-email" name="email" type="email" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Opening secure payment…" : "Checkout"}
      </Button>
      {state ? (
        <p role="status" className={state.ok ? "text-green-700" : "text-red-600"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

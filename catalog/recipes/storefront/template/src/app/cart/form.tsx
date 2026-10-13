"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyCoupon, checkout, type CheckoutState, type CouponState } from "./actions";

/** Discount code: checked and recomputed on the server; the cart summary updates when it applies. */
export function CouponForm() {
  const [state, action, pending] = useActionState<CouponState, FormData>(applyCoupon, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="co-code">Discount code</Label>
        <Input id="co-code" name="code" autoComplete="off" maxLength={40} />
      </div>
      <Button type="submit" disabled={pending}>
        Apply
      </Button>
      {state ? (
        <p role="status" className={`w-full text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** The country and shipping option come from the summary above; the server recomputes every amount. */
export function CheckoutForm({
  country,
  rateId,
  ready,
}: {
  country: string | null;
  rateId: string | null;
  ready: boolean;
}) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkout, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      {country ? <input type="hidden" name="country" value={country} /> : null}
      {rateId ? <input type="hidden" name="rateId" value={rateId} /> : null}
      <div>
        <Label htmlFor="co-email">Email for your receipt (optional)</Label>
        <Input id="co-email" name="email" type="email" />
      </div>
      <Button type="submit" disabled={pending || !ready}>
        {pending ? "Opening secure payment…" : "Checkout"}
      </Button>
      {state ? (
        <p role="status" className={state.ok ? "text-success" : "text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

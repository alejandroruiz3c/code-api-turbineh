"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinWaitlist, type JoinState } from "./actions";

/** Waitlist form (growth.waitlist.turbineh): name, email, and the referral code of the link the visitor came from. */
export function WaitlistForm() {
  const [state, action, pending] = useActionState<JoinState, FormData>(joinWaitlist, null);
  return (
    <form action={action} className="flex w-full max-w-md flex-col gap-3 text-left">
      <div>
        <Label htmlFor="wl-name">Name</Label>
        <Input id="wl-name" name="name" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="wl-email">Email</Label>
        <Input id="wl-email" name="email" type="email" required />
      </div>
      {/* Referral code from ?ref= of the page (a referral link), read when the form mounts. */}
      <input
        type="hidden"
        name="ref"
        ref={(el) => {
          if (el) el.value = new URLSearchParams(window.location.search).get("ref") ?? "";
        }}
      />
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join the waitlist"}
      </Button>
      {state ? (
        <p role="status" className={state.ok ? "text-success" : "text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

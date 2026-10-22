"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAccountName, type AccountState } from "./actions";

/** The person's display name, saved to their account. */
export function AccountNameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(updateAccountName, {
    error: null,
    saved: false,
  });
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <div>
        <Label htmlFor="account-name">Display name</Label>
        <Input id="account-name" name="name" defaultValue={name} required maxLength={80} />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p role="status" className="text-sm text-success">
          Name saved.
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}

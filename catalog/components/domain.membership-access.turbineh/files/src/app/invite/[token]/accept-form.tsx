"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction, type AcceptState } from "./actions";

/** The accept button of an invitation link; shows why it failed (expired, used, other email). */
export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(
    acceptInvitationAction,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>
        Accept invitation
      </Button>
      {state?.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

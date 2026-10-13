"use client";
import { useActionState } from "react";
import { cancelBooking, type CancelState } from "./actions";

/** One button; the server re-checks the link and the notice policy. */
export function CancelForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelBooking, null);
  if (state?.ok)
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-danger-soft px-4 py-2 text-sm font-medium text-danger disabled:opacity-50"
        >
          Cancel booking
        </button>
      </div>
      {state ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

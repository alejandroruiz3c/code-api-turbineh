"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { confirmSignup, type ConfirmState } from "../../actions";

/** One click confirms (a button, not the link itself, so mail scanners that open links never confirm anyone). */
export function ConfirmButton({ token }: { token: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmSignup, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col items-center gap-2">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-5 py-2 font-medium text-brand-contrast disabled:opacity-50"
      >
        Confirm my email
      </button>
      {state ? (
        <p role="status" className={state.ok ? "text-success" : "text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

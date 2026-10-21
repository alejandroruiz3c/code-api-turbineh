"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { syncNow, type SyncState } from "./actions";

/** "Sync now" (ai.mail-triage.turbineh): reads new mail and triages it; the server re-checks staff access. */
export function SyncForm() {
  const [state, action, pending] = useActionState<SyncState, FormData>(() => syncNow(), {
    error: null,
    done: null,
  });
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Reading mail…" : "Sync now"}
      </Button>
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
    </form>
  );
}

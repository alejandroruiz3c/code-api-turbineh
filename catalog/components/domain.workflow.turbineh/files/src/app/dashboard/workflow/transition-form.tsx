"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { moveWorkflowItem, type WorkflowState } from "./actions";

/** One button per transition the person may make, with an optional note; the server re-checks every rule. */
export function TransitionForm({
  id,
  transitions,
}: {
  id: string;
  transitions: { to: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<WorkflowState, FormData>(moveWorkflowItem, null);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Change status">
      <input type="hidden" name="id" value={id} />
      <label className="text-sm text-muted" htmlFor="wf-note">
        Note (optional)
      </label>
      <input
        id="wf-note"
        name="note"
        maxLength={500}
        className="w-full rounded-md border border-field px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <Button key={t.to} type="submit" name="to" value={t.to} disabled={pending}>
            {t.label}
          </Button>
        ))}
      </div>
      {state ? (
        <p role="status" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

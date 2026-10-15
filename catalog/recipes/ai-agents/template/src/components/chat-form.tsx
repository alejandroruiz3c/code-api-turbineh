"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendMessage, type ChatState } from "@/app/dashboard/agents/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function Send() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Thinking…" : "Send"}
    </Button>
  );
}

/** Chat input: the server action runs the orchestrated turn; safe error messages appear under the box. */
export function ChatForm({ agentId }: { agentId: string }) {
  const [state, action] = useActionState<ChatState, FormData>(sendMessage, { error: null });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="agentId" value={agentId} />
      <Label htmlFor="chat-text">Message</Label>
      <textarea
        id="chat-text"
        name="text"
        required
        maxLength={8000}
        rows={3}
        className="rounded-md border border-field p-2 text-sm"
      />
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div>
        <Send />
      </div>
    </form>
  );
}

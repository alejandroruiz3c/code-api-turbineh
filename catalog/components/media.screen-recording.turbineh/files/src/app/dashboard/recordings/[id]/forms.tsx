"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteAction, renameAction, revokeAction, shareAction } from "../actions";

/** Rename, share and delete forms of a recording (media.screen-recording.turbineh). */
export function RenameForm({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState(renameAction, null);
  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-1 flex-col gap-1 text-sm">
        Title
        <Input name="title" defaultValue={title} maxLength={160} required />
      </label>
      <Button disabled={pending}>Save title</Button>
      {state ? (
        <p role="status" className={state.ok ? "text-success" : "text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ShareForm({ id, shared }: { id: string; shared: boolean }) {
  const [shareState, share, sharing] = useActionState(shareAction, null);
  const [revokeState, revoke, revoking] = useActionState(revokeAction, null);
  const link = shareState?.link
    ? new URL(shareState.link, window.location.origin).toString()
    : null;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted">
        {shared ? "A share link is active. Creating a new one replaces it." : "Not shared."} Anyone
        with the link can watch, without an account.
      </p>
      <div className="flex gap-2">
        <form action={share}>
          <input type="hidden" name="id" value={id} />
          <Button disabled={sharing}>Create share link</Button>
        </form>
        <form action={revoke}>
          <input type="hidden" name="id" value={id} />
          <Button disabled={revoking} className="bg-subtle text-ink">
            Revoke share link
          </Button>
        </form>
      </div>
      {link ? (
        <p>
          Share link (shown once):{" "}
          <a data-testid="share-link" className="break-all text-accent" href={link}>
            {link}
          </a>
        </p>
      ) : null}
      {shareState && !shareState.ok ? <p className="text-danger">{shareState.message}</p> : null}
      {revokeState ? (
        <p role="status" className={revokeState.ok ? "text-success" : "text-danger"}>
          {revokeState.message}
        </p>
      ) : null}
    </div>
  );
}

export function DeleteForm({ id }: { id: string }) {
  return (
    <form action={deleteAction}>
      <input type="hidden" name="id" value={id} />
      <Button className="bg-danger-soft text-danger">Delete recording</Button>
    </form>
  );
}

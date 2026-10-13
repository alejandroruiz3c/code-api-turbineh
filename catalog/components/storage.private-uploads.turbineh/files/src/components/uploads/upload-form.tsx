"use client";
import { useActionState, useId } from "react";
import { uploadFile, type UploadState } from "@/app/dashboard/files/actions";
import { Button } from "@/components/ui/button";

/** File picker for one record (or loose workspace files); the server re-checks size, type, count and scope. */
export function UploadForm({
  subjectType,
  subjectId,
  back,
  accept,
  hint,
  scopes,
  scopeLabel,
}: {
  subjectType: string;
  subjectId?: string | null;
  back: string;
  accept: string;
  hint: string;
  scopes?: { id: string; name: string }[];
  scopeLabel?: string | null;
}) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadFile, null);
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Upload a file">
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId ?? ""} />
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-file`} className="text-sm font-medium text-muted">
            File
          </label>
          <input
            id={`${id}-file`}
            name="file"
            type="file"
            accept={accept}
            required
            className="text-sm"
          />
        </div>
        {scopeLabel && scopes?.length ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-scope`} className="text-sm font-medium text-muted">
              {scopeLabel}
            </label>
            <select
              id={`${id}-scope`}
              name="scopeId"
              className="rounded-md border border-field px-3 py-2 text-sm"
            >
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {state ? (
        <p role="status" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

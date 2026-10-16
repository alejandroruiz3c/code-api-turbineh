import { postAction } from "@/app/dashboard/social/posts/actions";

/** Labels of post statuses (social.publish.turbineh). */
export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  scheduled: "Scheduled",
  publishing: "Publishing",
  retrying: "Retrying",
  published: "Published",
  failed: "Failed",
  unknown: "Outcome unknown",
  cancelled: "Cancelled",
};

/** The actions a post's status allows (the service checks roles again). */
export function PostButtons({
  id,
  status,
  approver,
  back,
}: {
  id: string;
  status: string;
  approver: boolean;
  back: string;
}) {
  const ops: [string, string][] = [
    ...(status === "draft" ? [["submit", "Submit"] as [string, string]] : []),
    ...(status === "pending_approval" && approver
      ? ([
          ["approve", "Approve"],
          ["reject", "Send back to draft"],
        ] as [string, string][])
      : []),
    ...(status === "failed" || status === "unknown"
      ? [["retry", "Retry"] as [string, string]]
      : []),
    ...(["draft", "pending_approval", "scheduled", "retrying", "failed", "unknown"].includes(status)
      ? [["cancel", "Cancel"] as [string, string]]
      : []),
  ];
  if (ops.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {ops.map(([op, label]) => (
        <form key={op} action={postAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value={op} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className="rounded-md border border-line px-3 py-1 text-xs">
            {label}
          </button>
        </form>
      ))}
    </div>
  );
}

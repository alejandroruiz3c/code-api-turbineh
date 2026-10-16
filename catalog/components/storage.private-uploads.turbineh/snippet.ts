// A record page in the app (e.g. src/app/dashboard/workflow/request/[id]/page.tsx), written without JSX here.
import { createElement as h } from "react";
import { Attachments } from "@/components/uploads/attachments";
import { requireMember } from "@/server/authz";

export async function RequestFiles({ id }: { id: string }) {
  const ctx = await requireMember();
  // The record's scope is checked on the server (src/uploads/subjects.ts); downloads go through an authorised route.
  return h(Attachments, {
    ctx,
    subjectType: "workflow:request",
    subjectId: id,
    back: `/dashboard/workflow/request/${id}`,
  });
}
